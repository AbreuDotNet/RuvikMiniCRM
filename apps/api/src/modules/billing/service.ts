import { getDb } from '../../db/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { enqueue } from '../../lib/queue.js';
import { notify } from '../notifications/service.js';
import { randomToken } from '../../lib/crypto.js';

export async function listPlans() {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT id, code, name, description, price_cents, currency, interval, trial_days,
            max_services, max_quotes_per_month, features
       FROM subscription_plans WHERE is_active = true ORDER BY sort_order, price_cents`,
  );
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    currency: p.currency,
    interval: p.interval,
    trialDays: p.trial_days,
    maxServices: p.max_services,
    maxQuotesPerMonth: p.max_quotes_per_month,
    features: p.features,
  }));
}

export async function getSubscription(providerId: string) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
            s.cancel_at_period_end, s.cancelled_at, s.created_at,
            sp.id AS plan_id, sp.code, sp.name, sp.price_cents, sp.currency, sp.interval,
            sp.max_services, sp.features
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
      currency: s.currency, interval: s.interval, maxServices: s.max_services, features: s.features,
    },
    payments: payments.rows.map((p) => ({
      amountCents: p.amount_cents, currency: p.currency, status: p.status,
      method: p.method, paidAt: p.paid_at, createdAt: p.created_at,
    })),
  };
}

/**
 * Starts a subscription in `pending_payment` and returns a checkout intent.
 *
 * The account only becomes active when the payment provider's signed webhook
 * confirms the charge — never on the client's say-so, which is what stops a
 * forged success callback from granting a free subscription.
 */
export async function startSubscription(
  providerId: string,
  actorUserId: string,
  planCode: string,
) {
  const db = await getDb();

  return db.tx(async (c) => {
    const { rows: planRows } = await c.query<any>(
      'SELECT id, code, name, price_cents, currency, interval, trial_days FROM subscription_plans WHERE code = $1 AND is_active = true',
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
      plan: { code: plan.code, name: plan.name, priceCents: plan.price_cents, currency: plan.currency },
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

    const interval = sub.interval === 'year' ? '1 year' : '1 month';
    await c.query(
      `UPDATE subscriptions SET status = 'active',
              current_period_start = now(),
              current_period_end = now() + $2::interval,
              updated_at = now()
        WHERE id = $1`,
      [sub.id, interval],
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

    // Schedule the renewal check just after the period ends.
    await enqueue('billing.renew', { subscriptionId: sub.id }, {
      runAt: new Date(Date.now() + (sub.interval === 'year' ? 365 : 30) * 86_400_000),
      dedupeKey: `renew:${sub.id}`,
    }, c);

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
    await notify(rows[0].user_id, {
      type: 'subscription.payment_failed',
      title: 'Payment failed',
      body: 'We could not process your subscription payment. Please update your billing details.',
      data: { subscriptionId: rows[0].id },
    }, c);
    await writeAudit({
      actorUserId: null, actorRole: 'system', action: 'subscription.payment_failed',
      entityType: 'subscription', entityId: rows[0].id, metadata: { externalRef, reason },
    }, c);
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
