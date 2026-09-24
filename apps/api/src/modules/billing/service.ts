import { getDb, type Queryable } from '../../db/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { enqueue } from '../../lib/queue.js';
import { notify } from '../notifications/service.js';
import { randomToken } from '../../lib/crypto.js';
import { UNIMPLEMENTED_CAPABILITIES, type Capability } from './entitlements.js';
/*
 * The leaf modules, not the `stripe/index.js` barrel.
 *
 * The barrel re-exports `sync.js`, which imports this file for `GRACE_DAYS` and
 * `scheduleGraceExpiry` — so importing the barrel here would close a cycle
 * (service → index → sync → service). `config` and `checkout` depend on
 * neither, so reaching for them directly keeps the graph acyclic instead of
 * relying on ESM to tolerate it.
 */
import { isStripeConfigured } from './stripe/config.js';
import { createCheckoutSession, createPortalSession } from './stripe/checkout.js';

/**
 * Days a provider keeps their listing after a charge fails.
 *
 * A failed payment is far more often an expired card than a decision to leave,
 * so the listing does not vanish the same afternoon. It does have to vanish
 * eventually, or the subscription means nothing.
 */
export const GRACE_DAYS = 7;

const periodInterval = (interval: string) => (interval === 'year' ? '1 year' : '1 month');
const periodDays = (interval: string) => (interval === 'year' ? 365 : 30);

/**
 * Books the renewal check just after the period ends.
 *
 * The dedupe key carries the run date, and that detail is load-bearing. The
 * dedupe index covers `pending` **and** `processing`, and `completeJob` only
 * marks a job done *after* its handler returns — so a handler that reschedules
 * itself under a bare `renew:<id>` collides with the very job that is running
 * and the insert is silently dropped. A free plan would extend its period
 * exactly once and then never again.
 *
 * Scoping the key to the date keeps the property that mattered — two calls for
 * the same subscription and the same period cannot stack — while letting the
 * renewal handler book the next one.
 */
export async function scheduleRenewal(
  c: Queryable,
  subscriptionId: string,
  interval: string,
  /**
   * When to run, for a caller that already knows. The renewal handler passes
   * the period end it just wrote: anchoring to that rather than to `now()` is
   * both the correct moment and what guarantees a key distinct from the job
   * currently running, which would otherwise swallow the reschedule.
   */
  runAtOverride?: Date,
) {
  const runAt = runAtOverride
    ?? new Date(Date.now() + periodDays(interval) * 86_400_000);
  await enqueue('billing.renew', { subscriptionId }, {
    runAt,
    dedupeKey: `renew:${subscriptionId}:${runAt.toISOString().slice(0, 10)}`,
  }, c);
}

/**
 * Starts the clock on the grace window. Deduped per subscription, so a run of
 * failed charges cannot stack up several expiries against the same account.
 */
export async function scheduleGraceExpiry(c: Queryable, subscriptionId: string) {
  await enqueue('billing.grace_expired', { subscriptionId }, {
    runAt: new Date(Date.now() + GRACE_DAYS * 86_400_000),
    dedupeKey: `grace:${subscriptionId}`,
  }, c);
}

export async function listPlans() {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT id, code, name, tagline, description, price_cents, currency, interval, trial_days,
            max_clients, max_receipts_per_month, max_services, max_quotes_per_month,
            max_team_members, capabilities, features
       FROM subscription_plans WHERE is_active = true ORDER BY sort_order, price_cents`,
  );
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    priceCents: p.price_cents,
    currency: p.currency,
    interval: p.interval,
    trialDays: p.trial_days,
    // Grouped rather than flat: a pricing screen renders the allowances
    // together, and three of these were simply not exposed before.
    limits: {
      maxClients: p.max_clients,
      maxReceiptsPerMonth: p.max_receipts_per_month,
      maxServices: p.max_services,
      maxQuotesPerMonth: p.max_quotes_per_month,
      maxTeamMembers: p.max_team_members,
    },
    capabilities: p.capabilities ?? [],
    /**
     * Which of this plan's capabilities have nothing behind them yet.
     *
     * Derived here rather than left to each screen, and derived from the code
     * rather than from the catalogue, so an admin adding `fiscal_reports` to a
     * new tier cannot accidentally advertise a feature as working. The pricing
     * cards render every `feature` string with a tick; without this they tick
     * things the product cannot do, which stops being a roadmap problem and
     * starts being a misrepresentation the moment money changes hands.
     */
    unimplemented: ((p.capabilities ?? []) as Capability[]).filter((c) =>
      UNIMPLEMENTED_CAPABILITIES.includes(c),
    ),
    features: p.features,
    // Kept beside `limits` so the existing web and mobile screens keep working
    // while they move over to the grouped shape.
    maxServices: p.max_services,
    maxQuotesPerMonth: p.max_quotes_per_month,
  }));
}

export async function getSubscription(providerId: string) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
            s.cancel_at_period_end, s.cancelled_at, s.created_at,
            sp.id AS plan_id, sp.code, sp.name, sp.price_cents, sp.currency, sp.interval,
            sp.max_clients, sp.max_receipts_per_month, sp.max_services,
            sp.max_quotes_per_month, sp.max_team_members, sp.capabilities, sp.features
       FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.provider_id = $1
      ORDER BY s.created_at DESC LIMIT 1`,
    [providerId],
  );
  const s = rows[0];
  if (!s) return null;

  const payments = await db.query<any>(
    `SELECT amount_cents, currency, status, method, paid_at, created_at
       FROM payments WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 12`,
    [s.id],
  );

  return {
    id: s.id,
    status: s.status,
    currentPeriodStart: s.current_period_start,
    currentPeriodEnd: s.current_period_end,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    cancelledAt: s.cancelled_at,
    createdAt: s.created_at,
    plan: {
      id: s.plan_id, code: s.code, name: s.name, priceCents: s.price_cents,
      currency: s.currency, interval: s.interval, features: s.features,
      limits: {
        maxClients: s.max_clients,
        maxReceiptsPerMonth: s.max_receipts_per_month,
        maxServices: s.max_services,
        maxQuotesPerMonth: s.max_quotes_per_month,
        maxTeamMembers: s.max_team_members,
      },
      capabilities: s.capabilities ?? [],
      maxServices: s.max_services,
    },
    payments: payments.rows.map((p) => ({
      amountCents: p.amount_cents, currency: p.currency, status: p.status,
      method: p.method, paidAt: p.paid_at, createdAt: p.created_at,
    })),
  };
}

/**
 * Starts a subscription and returns a checkout intent.
 *
 * A priced plan lands in `pending_payment` and only becomes active when the
 * payment provider's signed webhook confirms the charge — never on the
 * client's say-so, which is what stops a forged success callback from granting
 * a paid subscription.
 *
 * A free plan is activated here instead. There is nothing to charge, so no
 * webhook is ever coming, and waiting for one stranded every free-plan
 * provider in `pending_payment` permanently. The rule is unchanged for
 * anything with a price; what makes this safe is that the price is read from
 * the plans table on the server, never from the request.
 */
export async function startSubscription(
  providerId: string,
  actorUserId: string,
  planCode: string,
  /**
   * The request's `Idempotency-Key`, threaded through to Stripe so a
   * double-tap on a slow connection produces one Checkout Session rather than
   * two. Falls back to a fresh token when the client sent none.
   */
  idempotencyKey?: string,
) {
  const db = await getDb();

  return db.tx(async (c) => {
    const { rows: planRows } = await c.query<any>(
      `SELECT id, code, name, price_cents, currency, interval, trial_days, stripe_price_id
         FROM subscription_plans WHERE code = $1 AND is_active = true`,
      [planCode],
    );
    const plan = planRows[0];
    if (!plan) throw notFound('That plan is not available.');

    const { rows: existing } = await c.query<any>(
      `SELECT id, status FROM subscriptions
        WHERE provider_id = $1 AND status IN ('pending_payment','trialing','active','past_due')`,
      [providerId],
    );
    if (existing.length && existing[0].status === 'active') {
      throw conflict('You already have an active subscription. Change your plan instead.');
    }
    // Replace an abandoned checkout rather than blocking on the unique index.
    if (existing.length) {
      await c.query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [
        existing[0].id,
      ]);
    }

    const planSummary = {
      code: plan.code, name: plan.name, priceCents: plan.price_cents, currency: plan.currency,
    };

    if (plan.price_cents === 0) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO subscriptions (provider_id, plan_id, status,
                                    current_period_start, current_period_end)
         VALUES ($1,$2,'active', now(), now() + $3::interval) RETURNING id`,
        [providerId, plan.id, periodInterval(plan.interval)],
      );
      // No payments row: nothing was charged, and inventing a zero-value
      // "succeeded" payment would put a phantom line in their billing history.
      await scheduleRenewal(c, rows[0].id, plan.interval);

      await writeAudit({
        actorUserId, actorRole: 'provider', action: 'subscription.started_free',
        entityType: 'subscription', entityId: rows[0].id,
        metadata: { plan: plan.code },
      }, c);

      return {
        subscriptionId: rows[0].id,
        status: 'active' as const,
        plan: planSummary,
        checkout: null,
      };
    }

    /*
     * Stripe Checkout, when there are credentials and the plan has a price in
     * Stripe to sell.
     *
     * The local row is still written as `pending_payment`, so a provider who
     * abandons checkout leaves a trace and the next attempt replaces it rather
     * than colliding with the one-live-subscription index. Nothing is
     * activated here: `checkout.session.completed` is what fills in the Stripe
     * ids and moves the status, which keeps the rule that only a signed
     * webhook can grant a paid plan.
     *
     * No Stripe customer is created up front. Checkout makes one from the
     * email, and `linkSubscription` writes the id back — one fewer API call,
     * and one fewer thing to leave orphaned if the provider never pays.
     */
    if (isStripeConfigured() && plan.stripe_price_id) {
      const { rows: ownerRows } = await c.query<{ email: string; stripe_customer_id: string | null }>(
        `SELECT u.email, p.stripe_customer_id
           FROM providers p JOIN users u ON u.id = p.user_id
          WHERE p.id = $1`,
        [providerId],
      );
      const owner = ownerRows[0];

      const { rows: pending } = await c.query<{ id: string }>(
        `INSERT INTO subscriptions (provider_id, plan_id, status)
         VALUES ($1,$2,'pending_payment') RETURNING id`,
        [providerId, plan.id],
      );

      const session = await createCheckoutSession({
        providerId,
        priceId: plan.stripe_price_id,
        customerId: owner?.stripe_customer_id ?? null,
        email: owner?.email ?? null,
        trialDays: plan.trial_days > 0 ? plan.trial_days : null,
        idempotencyKey: idempotencyKey ?? `checkout_${randomToken(16)}`,
      });

      await writeAudit({
        actorUserId, actorRole: 'provider', action: 'subscription.checkout_started',
        entityType: 'subscription', entityId: pending[0].id,
        metadata: { plan: plan.code, priceCents: plan.price_cents, gateway: 'stripe' },
      }, c);

      return {
        subscriptionId: pending[0].id,
        status: 'pending_payment' as const,
        plan: planSummary,
        // The client sends the provider here. Nothing is granted until the
        // webhook confirms.
        checkout: { url: session.url, sessionId: session.id },
      };
    }

    const externalRef = `sub_${randomToken(12)}`;
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO subscriptions (provider_id, plan_id, status, external_ref)
       VALUES ($1,$2,'pending_payment',$3) RETURNING id`,
      [providerId, plan.id, externalRef],
    );

    await c.query(
      `INSERT INTO payments (provider_id, subscription_id, kind, amount_cents, currency, status, external_ref)
       VALUES ($1,$2,'subscription',$3,$4,'pending',$5)`,
      [providerId, rows[0].id, plan.price_cents, plan.currency, externalRef],
    );

    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'subscription.checkout_started',
      entityType: 'subscription', entityId: rows[0].id,
      metadata: { plan: plan.code, priceCents: plan.price_cents },
    }, c);

    return {
      subscriptionId: rows[0].id,
      status: 'pending_payment' as const,
      plan: planSummary,
      // The client redirects here; the platform trusts only the webhook.
      checkout: {
        reference: externalRef,
        amountCents: plan.price_cents,
        currency: plan.currency,
      },
    };
  });
}

/** Applied by the signed billing webhook only. */
export async function activateSubscription(externalRef: string, paidAmountCents: number) {
  const db = await getDb();

  return db.tx(async (c) => {
    const { rows } = await c.query<any>(
      `SELECT s.id, s.provider_id, s.status, sp.interval, sp.price_cents, sp.name, p.user_id
         FROM subscriptions s
         JOIN subscription_plans sp ON sp.id = s.plan_id
         JOIN providers p ON p.id = s.provider_id
        WHERE s.external_ref = $1`,
      [externalRef],
    );
    const sub = rows[0];
    if (!sub) throw notFound('Unknown subscription reference.');
    if (sub.status === 'active') return { id: sub.id, status: 'active', alreadyActive: true };

    if (paidAmountCents < sub.price_cents) {
      throw conflict('Payment amount does not cover the plan price.');
    }

    await c.query(
      `UPDATE subscriptions SET status = 'active',
              current_period_start = now(),
              current_period_end = now() + $2::interval,
              updated_at = now()
        WHERE id = $1`,
      [sub.id, periodInterval(sub.interval)],
    );
    await c.query(
      `UPDATE payments SET status = 'succeeded', paid_at = now()
        WHERE external_ref = $1 AND status = 'pending'`,
      [externalRef],
    );

    await notify(sub.user_id, {
      type: 'subscription.active',
      title: 'Subscription active',
      body: `Your ${sub.name} plan is now active.`,
      data: { subscriptionId: sub.id },
    }, c);

    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.activated',
      entityType: 'subscription', entityId: sub.id,
      metadata: { externalRef, amountCents: paidAmountCents },
    }, c);

    // Schedule the renewal check just after the period ends. A grace-expiry
    // job left over from the failed charge this payment is settling stays
    // queued; its handler sees the subscription is active again and stops.
    await scheduleRenewal(c, sub.id, sub.interval);

    return { id: sub.id, status: 'active', alreadyActive: false };
  });
}

export async function markPaymentFailed(externalRef: string, reason: string) {
  const db = await getDb();
  await db.tx(async (c) => {
    const { rows } = await c.query<any>(
      `SELECT s.id, p.user_id FROM subscriptions s JOIN providers p ON p.id = s.provider_id
        WHERE s.external_ref = $1`,
      [externalRef],
    );
    if (!rows.length) return;
    await c.query(`UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE id = $1`, [
      rows[0].id,
    ]);
    await c.query(
      `UPDATE payments SET status = 'failed', failure_reason = $2 WHERE external_ref = $1`,
      [externalRef, reason.slice(0, 300)],
    );
    // The listing stays up for the grace window; this books the moment it
    // comes down if nothing is paid before then.
    await scheduleGraceExpiry(c, rows[0].id);

    await notify(rows[0].user_id, {
      type: 'subscription.payment_failed',
      title: 'Payment failed',
      body: `We could not process your subscription payment. Please update your billing `
        + `details within ${GRACE_DAYS} days to stay listed in search.`,
      data: { subscriptionId: rows[0].id },
    }, c);
    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.payment_failed',
      entityType: 'subscription', entityId: rows[0].id,
      metadata: { externalRef, reason, graceDays: GRACE_DAYS },
    }, c);
  });
}

/**
 * Opens Stripe's Customer Portal.
 *
 * This is what closes three gaps at once — plan changes with proration, a
 * stored card the provider can update, and a cancellation flow — without
 * building any of them. Stripe applies the change and tells us through
 * `customer.subscription.updated`, which `sync.ts` already handles, so nothing
 * here has to interpret the outcome.
 *
 * The subscription screen currently says "Switching without a gap is not
 * available yet". Once a deployment has Stripe credentials, this is the answer
 * to that.
 */
export async function createBillingPortalSession(
  providerId: string,
  idempotencyKey?: string,
): Promise<{ url: string }> {
  if (!isStripeConfigured()) {
    throw conflict('Self-service billing management is not enabled on this deployment.');
  }

  const db = await getDb();
  const { rows } = await db.query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM providers WHERE id = $1',
    [providerId],
  );
  const customerId = rows[0]?.stripe_customer_id;
  // No Stripe customer means they have never completed a checkout, so there is
  // nothing for the portal to manage. A clearer answer than Stripe's 400.
  if (!customerId) {
    throw conflict('Choose a plan first — there is no billing history to manage yet.');
  }

  return createPortalSession({
    customerId,
    idempotencyKey: idempotencyKey ?? `portal_${randomToken(16)}`,
  });
}

export async function cancelSubscription(providerId: string, actorUserId: string, immediate = false) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT id, status FROM subscriptions
      WHERE provider_id = $1 AND status IN ('active','trialing','past_due','pending_payment')`,
    [providerId],
  );
  const sub = rows[0];
  if (!sub) throw notFound('You do not have an active subscription.');

  if (immediate) {
    await db.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [sub.id],
    );
  } else {
    await db.query(
      `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = $1`,
      [sub.id],
    );
  }

  await writeAudit({
    actorUserId, actorRole: 'provider', action: 'subscription.cancelled',
    entityType: 'subscription', entityId: sub.id, metadata: { immediate },
  });

  return { id: sub.id, cancelAtPeriodEnd: !immediate };
}
