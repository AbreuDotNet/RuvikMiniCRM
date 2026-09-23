import type { Queryable } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import { conflict, forbidden } from '../../lib/errors.js';

/**
 * What a plan lets a provider do.
 *
 * One module answers this for the whole API. The alternative — each route
 * writing its own "what plan are they on" query — is how `max_quotes_per_month`
 * sat in the schema for the entire life of the product without a single
 * caller ever checking it.
 *
 * Two rules hold everywhere:
 *
 *   * A `null` quota means unlimited. Never zero, which the database also
 *     refuses: zero is indistinguishable from "unset" at a glance and locks a
 *     paying customer out of the thing they bought.
 *   * No live subscription means the *most restrictive* active plan, not
 *     "anything goes". Failing open on a billing limit is how the free tier
 *     ends up more generous than the paid one.
 */

export const CAPABILITIES = [
  'fiscal_reports',
  'tax_estimates',
  'priority_support',
  'team_members',
  'payment_gateway',
  'advanced_backup',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capabilities with nothing behind them yet.
 *
 * They are real entitlements — the admin sets them, the plan advertises them,
 * the API reports them — but no endpoint consumes them, because the feature
 * does not exist. Listed here so the apps can say "included in your plan,
 * coming soon" instead of offering a button that does nothing, and so that
 * whoever builds the feature knows the entitlement is already waiting.
 */
export const UNIMPLEMENTED_CAPABILITIES: readonly Capability[] = [
  'fiscal_reports',
  'tax_estimates',
  'team_members',
  'payment_gateway',
  'advanced_backup',
];

export interface PlanLimits {
  maxClients: number | null;
  maxReceiptsPerMonth: number | null;
  maxServices: number | null;
  maxQuotesPerMonth: number | null;
  maxTeamMembers: number;
}

export interface Entitlements {
  planId: string;
  planCode: string;
  planName: string;
  /** The subscription's status, or null when the provider has none. */
  subscriptionStatus: string | null;
  /**
   * True when these entitlements come from a live subscription rather than
   * from the fallback. The apps use it to explain why limits look tight.
   */
  fromLiveSubscription: boolean;
  limits: PlanLimits;
  capabilities: Capability[];
}

/** Subscription states that still entitle a provider to their plan. */
const LIVE_STATUSES = ['trialing', 'active', 'past_due'];

interface PlanRow {
  id: string;
  code: string;
  name: string;
  max_clients: number | null;
  max_receipts_per_month: number | null;
  max_services: number | null;
  max_quotes_per_month: number | null;
  max_team_members: number;
  capabilities: string[] | null;
  status: string | null;
}

function toEntitlements(row: PlanRow, live: boolean): Entitlements {
  return {
    planId: row.id,
    planCode: row.code,
    planName: row.name,
    subscriptionStatus: row.status,
    fromLiveSubscription: live,
    limits: {
      maxClients: row.max_clients,
      maxReceiptsPerMonth: row.max_receipts_per_month,
      maxServices: row.max_services,
      maxQuotesPerMonth: row.max_quotes_per_month,
      maxTeamMembers: row.max_team_members,
    },
    // Postgres hands back a real array; the cast narrows it to the vocabulary
    // the CHECK constraint already guarantees.
    capabilities: (row.capabilities ?? []) as Capability[],
  };
}

/**
 * The entitlements in force for a provider right now.
 *
 * Resolved in one query: the live subscription's plan if there is one, and
 * otherwise the cheapest active plan. `past_due` still counts — that is the
 * grace period, and cutting someone off mid-grace would make the grace
 * meaningless.
 */
export async function getEntitlements(
  providerId: string,
  c: Queryable | null = null,
): Promise<Entitlements> {
  const db = c ?? (await getDb());

  const { rows } = await db.query<PlanRow>(
    `SELECT sp.id, sp.code, sp.name,
            sp.max_clients, sp.max_receipts_per_month, sp.max_services,
            sp.max_quotes_per_month, sp.max_team_members, sp.capabilities,
            s.status
       FROM subscriptions s
       JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.provider_id = $1
        AND s.status = ANY($2::text[])
      LIMIT 1`,
    [providerId, LIVE_STATUSES],
  );

  if (rows[0]) return toEntitlements(rows[0], true);

  // No live subscription: fall back to the cheapest active plan rather than
  // to no limits at all.
  const { rows: fallback } = await db.query<PlanRow>(
    `SELECT id, code, name,
            max_clients, max_receipts_per_month, max_services,
            max_quotes_per_month, max_team_members, capabilities,
            NULL::text AS status
       FROM subscription_plans
      WHERE is_active = true
      ORDER BY price_cents, sort_order
      LIMIT 1`,
  );

  if (!fallback[0]) {
    // No plans at all is a misconfigured deployment, not a user error.
    throw conflict('No subscription plan is available. Contact support.');
  }
  return toEntitlements(fallback[0], false);
}

export function hasCapability(entitlements: Entitlements, capability: Capability): boolean {
  return entitlements.capabilities.includes(capability);
}

/**
 * Refuses an action the plan does not cover.
 *
 * A 403 rather than a 409: the request is well formed and the state is fine,
 * the caller simply is not allowed. The message names the plan they are on so
 * the answer to "why?" is in the error itself.
 */
export function assertCapability(
  entitlements: Entitlements,
  capability: Capability,
  what: string,
): void {
  if (hasCapability(entitlements, capability)) return;
  throw forbidden(`${what} is not included in the ${entitlements.planName} plan.`);
}

export interface UsageCheck {
  used: number;
  limit: number | null;
  /** True when one more would exceed the allowance. */
  exhausted: boolean;
}

function check(used: number, limit: number | null): UsageCheck {
  return { used, limit, exhausted: limit !== null && used >= limit };
}

/** How many clients the provider keeps. */
export async function countClients(providerId: string, c: Queryable): Promise<number> {
  const { rows } = await c.query<{ count: string }>(
    'SELECT count(*)::text FROM clients WHERE provider_id = $1',
    [providerId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Receipts issued in the current calendar month.
 *
 * Calendar month, not a rolling window tied to the billing period: "20 a
 * month" is what the plan says, and a quota that resets on a date the customer
 * cannot predict is a quota they cannot plan around. Counted on `paid_at`
 * because that is when the receipt was earned.
 */
export async function countReceiptsThisMonth(
  providerId: string,
  c: Queryable,
): Promise<number> {
  const { rows } = await c.query<{ count: string }>(
    `SELECT count(*)::text FROM payments
      WHERE provider_id = $1
        AND receipt_number IS NOT NULL
        AND paid_at >= date_trunc('month', now())
        AND paid_at <  date_trunc('month', now()) + interval '1 month'`,
    [providerId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countServices(providerId: string, c: Queryable): Promise<number> {
  const { rows } = await c.query<{ count: string }>(
    'SELECT count(*)::text FROM services WHERE provider_id = $1',
    [providerId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countQuotesThisMonth(providerId: string, c: Queryable): Promise<number> {
  const { rows } = await c.query<{ count: string }>(
    `SELECT count(*)::text FROM quotes
      WHERE provider_id = $1
        AND created_at >= date_trunc('month', now())
        AND created_at <  date_trunc('month', now()) + interval '1 month'`,
    [providerId],
  );
  return Number(rows[0]?.count ?? 0);
}

export interface UsageSnapshot {
  clients: UsageCheck;
  receiptsThisMonth: UsageCheck;
  services: UsageCheck;
  quotesThisMonth: UsageCheck;
}

/** Everything the provider has used against everything they are allowed. */
export async function getUsage(
  providerId: string,
  entitlements: Entitlements,
  c: Queryable | null = null,
): Promise<UsageSnapshot> {
  const db = c ?? (await getDb());
  const [clients, receipts, services, quotes] = await Promise.all([
    countClients(providerId, db),
    countReceiptsThisMonth(providerId, db),
    countServices(providerId, db),
    countQuotesThisMonth(providerId, db),
  ]);

  return {
    clients: check(clients, entitlements.limits.maxClients),
    receiptsThisMonth: check(receipts, entitlements.limits.maxReceiptsPerMonth),
    services: check(services, entitlements.limits.maxServices),
    quotesThisMonth: check(quotes, entitlements.limits.maxQuotesPerMonth),
  };
}

/**
 * Refuses the action that would cross a quota.
 *
 * A 409 rather than a 403: the plan does cover this kind of action, there is
 * simply no allowance left — and unlike a capability, it resolves itself next
 * month or on an upgrade. `details` carries the numbers so a client can show
 * "10 of 10" without a second request.
 */
export function assertWithinQuota(
  usage: UsageCheck,
  entitlements: Entitlements,
  noun: string,
  period?: string,
): void {
  if (!usage.exhausted) return;
  throw conflict(
    `The ${entitlements.planName} plan includes ${usage.limit} ${noun}${period ? ` ${period}` : ''}. `
    + 'Upgrade your plan to add more.',
    {
      reason: 'plan_limit_reached',
      planCode: entitlements.planCode,
      limit: usage.limit,
      used: usage.used,
      resource: noun,
    },
  );
}
