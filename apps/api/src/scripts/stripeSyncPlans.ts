/**
 * Creates the Stripe Products and Prices for Ruvik's plans, then writes each
 * Price id back into `subscription_plans.stripe_price_id`.
 *
 * Run once per Stripe environment (each sandbox, then live):
 *
 *   STRIPE_SECRET_KEY=rk_test_... npm run stripe:sync-plans -w @ruvik/api
 *
 * ## One Product per plan, not one Product with three Prices
 *
 * Checkout and every Stripe invoice show the *Product* name on each line item.
 * Three tiers sharing one Product means every line reads the same, and a
 * customer cannot tell from their invoice which plan they bought. Multiple
 * Prices on one Product are for variants of the same plan — monthly versus
 * annual, or another currency — which is why the annual Price added below sits
 * on the same Product as the monthly one.
 *
 * ## Idempotent, and it never repoints an existing Price
 *
 * Stripe Prices are immutable: changing what a plan costs means creating a new
 * Price and pointing at it, which leaves existing subscribers on the old one
 * until they move. So this script will create a missing Price but will not
 * overwrite a `stripe_price_id` that is already set — doing that silently would
 * change what the next renewal quotes for everybody on the plan. Re-pricing is
 * a deliberate act: clear the column, or set the new id by hand.
 *
 * The free plan is skipped. There is nothing to charge, `startSubscription`
 * activates it inline, and a zero-amount Price would only add a Stripe object
 * that never gets used.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/index.js';
import { stripe } from '../modules/billing/stripe/client.js';
import { isStripeConfigured } from '../modules/billing/stripe/config.js';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
}

interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
}

async function main(): Promise<void> {
  if (!isStripeConfigured()) {
    console.error(
      'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both be set.\n'
      + 'A restricted key (rk_…) is preferred over a secret key (sk_…).',
    );
    process.exit(1);
  }

  const db = await getDb();
  const { rows: plans } = await db.query<PlanRow>(
    `SELECT id, code, name, description, price_cents, currency, interval, stripe_price_id
       FROM subscription_plans
      WHERE is_active = true
      ORDER BY sort_order, price_cents`,
  );

  if (!plans.length) {
    console.error('No active plans found. Run the seed first.');
    process.exit(1);
  }

  for (const plan of plans) {
    if (plan.price_cents === 0) {
      console.log(`· ${plan.code}: free, nothing to create in Stripe`);
      continue;
    }

    if (plan.stripe_price_id) {
      // Verify rather than assume: a price id carried over from another
      // sandbox is the kind of thing that only surfaces at the first checkout.
      const existing = await stripe
        .get<StripePrice>(`/prices/${plan.stripe_price_id}`)
        .catch(() => null);

      if (existing) {
        const matches = existing.unit_amount === plan.price_cents
          && existing.currency.toLowerCase() === plan.currency.toLowerCase()
          && existing.recurring?.interval === plan.interval;
        console.log(
          matches
            ? `✓ ${plan.code}: ${plan.stripe_price_id} already set and matches`
            : `! ${plan.code}: ${plan.stripe_price_id} is set but does NOT match the catalogue `
              + `(Stripe says ${existing.unit_amount} ${existing.currency}/`
              + `${existing.recurring?.interval ?? 'one-off'}; Ruvik says ${plan.price_cents} `
              + `${plan.currency}/${plan.interval}). Prices are immutable — clear the column to `
              + 'create a new one, which leaves current subscribers where they are.',
        );
        continue;
      }
      console.log(`! ${plan.code}: ${plan.stripe_price_id} is not in this Stripe environment`);
    }

    const product = await stripe.post<{ id: string; default_price: StripePrice | string | null }>(
      '/products',
      {
        name: `Ruvik ${plan.name}`,
        description: plan.description ?? undefined,
        default_price_data: {
          unit_amount: plan.price_cents,
          currency: plan.currency.toLowerCase(),
          recurring: { interval: plan.interval },
        },
        metadata: { ruvik_plan_code: plan.code, ruvik_plan_id: plan.id },
        expand: ['default_price'],
      },
      // Keyed on the plan, so re-running after a network failure does not
      // create a second Product for the same tier.
      { idempotencyKey: `ruvik_product_${plan.id}` },
    );

    const priceId = typeof product.default_price === 'string'
      ? product.default_price
      : product.default_price?.id;

    if (!priceId) {
      console.error(`✗ ${plan.code}: Stripe created product ${product.id} with no default price`);
      process.exitCode = 1;
      continue;
    }

    await db.query(
      'UPDATE subscription_plans SET stripe_price_id = $2 WHERE id = $1',
      [plan.id, priceId],
    );
    console.log(`✓ ${plan.code}: product ${product.id}, price ${priceId}`);
  }

  console.log(
    '\nNext: create the webhook endpoint at POST /api/v1/webhooks/stripe and subscribe it to\n'
    + 'the events listed in docs/stripe-integration.md, then put its signing secret in\n'
    + 'STRIPE_WEBHOOK_SECRET.',
  );
}

/**
 * Guarded like `db/migrate.ts`: this file is compiled into `dist`, and a
 * top-level `main()` would run — and start calling Stripe — on any import.
 */
const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error('stripe:sync-plans failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
