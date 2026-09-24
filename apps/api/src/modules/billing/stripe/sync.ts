import { getDb, type Queryable } from '../../../db/index.js';
import { logger } from '../../../lib/logger.js';
import { writeAudit } from '../../../lib/audit.js';
import { notify } from '../../notifications/service.js';
import { GRACE_DAYS, scheduleGraceExpiry } from '../service.js';
import { fetchSubscription } from './checkout.js';
import {
  readCheckoutSession, readInvoice, readSubscription,
  type StripeEventEnvelope, type StripeIntent,
} from './events.js';
import {
  fromStripeTimestamp, opensGraceWindow, toRuvikStatus,
  type RuvikSubscriptionStatus,
} from './mapping.js';

/**
 * Applying a Stripe event to Ruvik's own tables.
 *
 * This is the half of the integration that did not exist: `events.ts` decided
 * what an event *means* and nothing carried it out, so the whole folder was
 * inert. Everything here is keyed on ids Stripe gave us, never on our own
 * request state, because a webhook can arrive before, after, or instead of the
 * response to the call that caused it.
 *
 * ## Two rules that shape every function below
 *
 * **Stripe does not guarantee webhook ordering.** An `updated` delivered late
 * can carry an older status than one already applied. So a status change
 * re-reads the subscription from Stripe rather than trusting the payload — one
 * extra call to avoid writing a stale status that decides whether somebody
 * appears in search.
 *
 * **Events resolve through Stripe's object graph, not through metadata.**
 * `client_reference_id` is used exactly once, on the checkout session, to
 * attach Stripe's ids to a provider. Everything after that is found by
 * `stripe_subscription_id` or `stripe_customer_id`. Metadata is a fallback for
 * when the graph cannot answer, not the primary index.
 */

export interface AppliedIntent {
  intent: StripeIntent;
  /** What changed, for the log and the audit trail. Never a reason to branch. */
  outcome: 'applied' | 'ignored';
  detail?: string;
}

/** Routes one verified event to its handler. */
export async function applyIntent(
  intent: StripeIntent,
  event: StripeEventEnvelope,
): Promise<AppliedIntent> {
  switch (intent) {
    case 'link_subscription': return linkSubscription(event);
    case 'sync_subscription': return syncSubscription(event);
    case 'end_subscription': return endSubscription(event);
    case 'record_payment': return recordPayment(event);
    case 'payment_failed': return paymentFailed(event);
    case 'warn_trial_ending': return warnTrialEnding(event);
    default: {
      // Exhaustiveness: a new intent added to the table without a handler here
      // is a compile error rather than a silently dropped event.
      const unreachable: never = intent;
      return { intent: unreachable, outcome: 'ignored', detail: 'no handler' };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* link_subscription                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Attaches Stripe's customer and subscription to the provider who started the
 * checkout, then syncs the subscription itself.
 *
 * This is the only place `client_reference_id` is read. After this, the Stripe
 * ids are on our rows and every later event finds its way by those.
 */
async function linkSubscription(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const session = readCheckoutSession(event.data.object);

  // Gated on payment_status, not on the event name: `completed` fires for
  // payment methods that have not settled yet, and activating on that would
  // grant a plan nobody has paid for.
  if (session.paymentStatus !== 'paid' && session.paymentStatus !== 'no_payment_required') {
    return {
      intent: 'link_subscription',
      outcome: 'ignored',
      detail: `payment_status=${session.paymentStatus ?? 'null'}`,
    };
  }
  if (!session.clientReferenceId || !session.subscriptionId) {
    return { intent: 'link_subscription', outcome: 'ignored', detail: 'session missing ids' };
  }

  const db = await getDb();
  const { rowCount } = await db.query(
    `UPDATE providers SET stripe_customer_id = COALESCE($2, stripe_customer_id), updated_at = now()
      WHERE id = $1`,
    [session.clientReferenceId, session.customerId],
  );
  if (!rowCount) {
    // A session whose client_reference_id names no provider is either a test
    // fired by hand or a different deployment sharing the endpoint. Not an
    // error worth retrying.
    logger.warn({ providerId: session.clientReferenceId }, 'stripe checkout for unknown provider');
    return { intent: 'link_subscription', outcome: 'ignored', detail: 'unknown provider' };
  }

  await upsertSubscription(session.subscriptionId, session.clientReferenceId);
  return { intent: 'link_subscription', outcome: 'applied', detail: session.subscriptionId };
}

/* -------------------------------------------------------------------------- */
/* sync_subscription                                                          */
/* -------------------------------------------------------------------------- */

async function syncSubscription(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const incoming = readSubscription(event.data.object);
  if (!incoming.id) {
    return { intent: 'sync_subscription', outcome: 'ignored', detail: 'no subscription id' };
  }
  const applied = await upsertSubscription(incoming.id, null);
  return {
    intent: 'sync_subscription',
    outcome: applied ? 'applied' : 'ignored',
    detail: incoming.id,
  };
}

/**
 * Writes a Stripe subscription across to ours, creating the row if this is the
 * first time we have seen it.
 *
 * `providerId` is supplied only by the checkout path, where it comes from
 * `client_reference_id`. Every other caller passes null and the row is found by
 * the Stripe subscription id, or failing that by the Stripe customer id — the
 * two indexes migration 006 added for exactly this.
 */
async function upsertSubscription(
  stripeSubscriptionId: string,
  providerId: string | null,
): Promise<boolean> {
  // Re-read rather than trust the payload: Stripe does not order webhooks, and
  // this status decides search visibility.
  const sub = await fetchSubscription(stripeSubscriptionId);
  const status = toRuvikStatus(sub.status);

  const db = await getDb();

  return db.tx(async (c) => {
    const target = providerId ?? (await resolveProvider(c, stripeSubscriptionId, sub.customerId));
    if (!target) {
      logger.warn({ stripeSubscriptionId }, 'stripe subscription matches no provider');
      return false;
    }

    // The plan comes from the price. A subscription on a price we do not sell
    // keeps whatever plan the row already had rather than being pointed at an
    // arbitrary one.
    const planId = sub.priceId ? await planForPrice(c, sub.priceId) : null;

    const { rows: existing } = await c.query<{ id: string; status: RuvikSubscriptionStatus }>(
      `SELECT id, status FROM subscriptions
        WHERE stripe_subscription_id = $1
           OR (provider_id = $2 AND status IN ('pending_payment','trialing','active','past_due'))
        ORDER BY (stripe_subscription_id = $1) DESC
        LIMIT 1`,
      [stripeSubscriptionId, target],
    );

    const periodStart = fromStripeTimestamp(sub.currentPeriodStart);
    const periodEnd = fromStripeTimestamp(sub.currentPeriodEnd);

    if (existing[0]) {
      await c.query(
        `UPDATE subscriptions
            SET status = $2,
                stripe_subscription_id = $3,
                stripe_status = $4,
                plan_id = COALESCE($5, plan_id),
                current_period_start = COALESCE($6, current_period_start),
                current_period_end = COALESCE($7, current_period_end),
                cancel_at_period_end = $8,
                cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
                updated_at = now()
          WHERE id = $1`,
        [existing[0].id, status, stripeSubscriptionId, sub.status, planId,
         periodStart, periodEnd, sub.cancelAtPeriodEnd],
      );

      if (opensGraceWindow(existing[0].status, status)) {
        await scheduleGraceExpiry(c, existing[0].id);
      }
    } else {
      if (!planId) {
        logger.warn({ stripeSubscriptionId, priceId: sub.priceId }, 'stripe price maps to no plan');
        return false;
      }
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO subscriptions (provider_id, plan_id, status, stripe_subscription_id,
                                    stripe_status, current_period_start, current_period_end,
                                    cancel_at_period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [target, planId, status, stripeSubscriptionId, sub.status,
         periodStart, periodEnd, sub.cancelAtPeriodEnd],
      );
      if (status === 'past_due') await scheduleGraceExpiry(c, rows[0].id);
    }

    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.stripe_synced',
      entityType: 'subscription', entityId: stripeSubscriptionId,
      metadata: { stripeStatus: sub.status, status, providerId: target },
    }, c);

    return true;
  });
}

/** Finds the provider a Stripe subscription belongs to, by subscription then customer. */
async function resolveProvider(
  c: Queryable,
  stripeSubscriptionId: string,
  stripeCustomerId: string | null,
): Promise<string | null> {
  const { rows: bySub } = await c.query<{ provider_id: string }>(
    'SELECT provider_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1',
    [stripeSubscriptionId],
  );
  if (bySub[0]) return bySub[0].provider_id;

  if (!stripeCustomerId) return null;
  const { rows: byCustomer } = await c.query<{ id: string }>(
    'SELECT id FROM providers WHERE stripe_customer_id = $1 LIMIT 1',
    [stripeCustomerId],
  );
  return byCustomer[0]?.id ?? null;
}

async function planForPrice(c: Queryable, priceId: string): Promise<string | null> {
  const { rows } = await c.query<{ id: string }>(
    'SELECT id FROM subscription_plans WHERE stripe_price_id = $1 LIMIT 1',
    [priceId],
  );
  return rows[0]?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* end_subscription                                                           */
/* -------------------------------------------------------------------------- */

async function endSubscription(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const sub = readSubscription(event.data.object);
  if (!sub.id) return { intent: 'end_subscription', outcome: 'ignored', detail: 'no id' };

  const db = await getDb();
  const { rows } = await db.query<{ id: string; provider_id: string; name: string }>(
    `UPDATE subscriptions s
        SET status = 'cancelled', cancelled_at = COALESCE(s.cancelled_at, now()),
            stripe_status = $2, updated_at = now()
      WHERE s.stripe_subscription_id = $1
      RETURNING s.id, s.provider_id,
                (SELECT name FROM subscription_plans WHERE id = s.plan_id) AS name`,
    [sub.id, sub.status || 'canceled'],
  );
  if (!rows[0]) return { intent: 'end_subscription', outcome: 'ignored', detail: 'no such row' };

  const { rows: owner } = await db.query<{ user_id: string }>(
    'SELECT user_id FROM providers WHERE id = $1',
    [rows[0].provider_id],
  );
  if (owner[0]) {
    await notify(owner[0].user_id, {
      type: 'subscription.ended',
      title: 'Subscription ended',
      body: `Your ${rows[0].name} plan has ended. Choose a plan to appear in search again.`,
      data: { subscriptionId: rows[0].id },
    });
  }

  await writeAudit({
    actorUserId: null, actorRole: 'system', action: 'subscription.stripe_cancelled',
    entityType: 'subscription', entityId: rows[0].id,
    metadata: { stripeSubscriptionId: sub.id },
  });

  return { intent: 'end_subscription', outcome: 'applied', detail: rows[0].id };
}

/* -------------------------------------------------------------------------- */
/* record_payment                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Records a settled Stripe invoice as a payment against the subscription.
 *
 * `kind = 'subscription'`, so it lands in the provider's billing history
 * beside the manual-flow rows and nowhere near `recordPayment` in the invoices
 * module — that one is a provider collecting from *their* customer, which is a
 * different table's worth of meaning and, from Phase 2, a different Stripe
 * account.
 *
 * The Stripe invoice id goes into `external_ref`, whose partial unique index
 * makes a redelivered `invoice.paid` a no-op rather than a duplicate payment.
 */
async function recordPayment(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const invoice = readInvoice(event.data.object);
  if (!invoice.id || invoice.amountPaidCents <= 0) {
    return { intent: 'record_payment', outcome: 'ignored', detail: 'nothing settled' };
  }

  const db = await getDb();

  return db.tx(async (c) => {
    const { rows: sub } = await c.query<{ id: string; provider_id: string }>(
      `SELECT id, provider_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [invoice.subscriptionId ?? ''],
    );

    const providerId = sub[0]?.provider_id
      ?? (invoice.customerId
        ? (await c.query<{ id: string }>(
            'SELECT id FROM providers WHERE stripe_customer_id = $1 LIMIT 1',
            [invoice.customerId],
          )).rows[0]?.id
        : undefined);

    if (!providerId) {
      logger.warn({ invoiceId: invoice.id }, 'stripe invoice matches no provider');
      return { intent: 'record_payment' as const, outcome: 'ignored' as const, detail: 'no provider' };
    }

    const { rows: inserted } = await c.query<{ id: string }>(
      `INSERT INTO payments (provider_id, subscription_id, kind, amount_cents, currency,
                             status, method, external_ref, stripe_invoice_url, paid_at)
       VALUES ($1,$2,'subscription',$3,$4,'succeeded','card',$5,$6, now())
       ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [providerId, sub[0]?.id ?? null, invoice.amountPaidCents, invoice.currency,
       invoice.id, invoice.hostedInvoiceUrl],
    );

    if (!inserted[0]) {
      return { intent: 'record_payment' as const, outcome: 'ignored' as const, detail: 'already recorded' };
    }

    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.payment_recorded',
      entityType: 'payment', entityId: inserted[0].id,
      metadata: { stripeInvoiceId: invoice.id, amountCents: invoice.amountPaidCents },
    }, c);

    return { intent: 'record_payment' as const, outcome: 'applied' as const, detail: inserted[0].id };
  });
}

/* -------------------------------------------------------------------------- */
/* payment_failed                                                             */
/* -------------------------------------------------------------------------- */

async function paymentFailed(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const invoice = readInvoice(event.data.object);
  if (!invoice.subscriptionId) {
    return { intent: 'payment_failed', outcome: 'ignored', detail: 'not a subscription invoice' };
  }

  const db = await getDb();

  return db.tx(async (c) => {
    const { rows } = await c.query<{
      id: string; provider_id: string; status: RuvikSubscriptionStatus; name: string;
    }>(
      `SELECT s.id, s.provider_id, s.status,
              (SELECT name FROM subscription_plans WHERE id = s.plan_id) AS name
         FROM subscriptions s WHERE s.stripe_subscription_id = $1 LIMIT 1`,
      [invoice.subscriptionId],
    );
    if (!rows[0]) {
      return { intent: 'payment_failed' as const, outcome: 'ignored' as const, detail: 'no such row' };
    }

    await c.query(
      `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE id = $1`,
      [rows[0].id],
    );
    // Only on the way in, so a second failed retry inside the same window does
    // not push the expiry date out each time.
    if (opensGraceWindow(rows[0].status, 'past_due')) {
      await scheduleGraceExpiry(c, rows[0].id);
    }

    const { rows: owner } = await c.query<{ user_id: string }>(
      'SELECT user_id FROM providers WHERE id = $1',
      [rows[0].provider_id],
    );
    if (owner[0]) {
      await notify(owner[0].user_id, {
        type: 'subscription.payment_failed',
        title: 'Payment failed',
        body: `We could not charge your card for the ${rows[0].name} plan. Update your billing `
          + `details within ${GRACE_DAYS} days to stay listed in search.`,
        data: { subscriptionId: rows[0].id },
      }, c);
    }

    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.payment_failed',
      entityType: 'subscription', entityId: rows[0].id,
      metadata: { stripeInvoiceId: invoice.id, graceDays: GRACE_DAYS },
    }, c);

    return { intent: 'payment_failed' as const, outcome: 'applied' as const, detail: rows[0].id };
  });
}

/* -------------------------------------------------------------------------- */
/* warn_trial_ending                                                          */
/* -------------------------------------------------------------------------- */

async function warnTrialEnding(event: StripeEventEnvelope): Promise<AppliedIntent> {
  const sub = readSubscription(event.data.object);
  if (!sub.id) return { intent: 'warn_trial_ending', outcome: 'ignored', detail: 'no id' };

  const db = await getDb();
  const { rows } = await db.query<{ id: string; user_id: string; name: string }>(
    `SELECT s.id, p.user_id, sp.name
       FROM subscriptions s
       JOIN providers p ON p.id = s.provider_id
       JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.stripe_subscription_id = $1 LIMIT 1`,
    [sub.id],
  );
  if (!rows[0]) return { intent: 'warn_trial_ending', outcome: 'ignored', detail: 'no such row' };

  await notify(rows[0].user_id, {
    type: 'subscription.trial_ending',
    title: 'Your trial is ending soon',
    body: `Your ${rows[0].name} trial ends shortly. Add a payment method to keep your listings live.`,
    data: { subscriptionId: rows[0].id },
  });

  return { intent: 'warn_trial_ending', outcome: 'applied', detail: rows[0].id };
}
