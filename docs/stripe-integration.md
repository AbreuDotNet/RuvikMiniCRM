# Stripe integration plan

Ruvik has two distinct money flows, and they need different Stripe products.
This document records which, why, and in what order they get built.

Generated against Stripe's own guidance (the `stripe-best-practices` and
`connect-recommend` skills in [.agents/skills/](../.agents/skills/)) and the
API reference, at API version **`2026-08-26.dahlia`**.

---

## The two flows

| | Flow A — platform revenue | Flow B — provider revenue |
|---|---|---|
| Who pays | Provider → Ruvik | Homeowner → Provider |
| What for | $0 / $14.99 / $29.99 a month | A plumbing invoice |
| Stripe product | **Billing** + Checkout | **Connect** + Payments |
| Merchant of record | Ruvik | **The provider** |
| Connect involved | No | Yes |
| Phase | **1** | **2** |

Keeping these apart is the whole design. They share a provider row and nothing
else: different merchant of record, different liability, different tax position.

---

## Decisions

### 1. Flow B uses direct charges, not destination charges

The provider is merchant of record. Their name on the homeowner's card
statement; they own refunds and disputes; Ruvik takes `application_fee_amount`.

| v2 field | Value |
|---|---|
| `dashboard` | `full` |
| `defaults.responsibilities.fees_collector` | `stripe` |
| `defaults.responsibilities.losses_collector` | `stripe` |
| Account configuration | `configuration.merchant`, requesting `card_payments` |
| Charge pattern | Direct |

Stripe's compatibility matrix rates this combination **ALLOWED** and names it
the blessed SaaS path. The alternative — `express` / `application` /
`application` / destination — is the blessed *marketplace* path, and Stripe's
own decision tree leans that way for a platform where "customers discover
services on your platform and complete checkout in your platform flow".

**The reason Ruvik goes the other way is sales tax.** Every invoice this
product issues carries the provider's business name, address, `tax_state` and a
per-line `tax_treatment` with a stated reason and, where a state demands one, a
`tax_exemption_certificate` — see [005_invoice_tax_evidence.sql](../apps/api/src/db/migrations/005_invoice_tax_evidence.sql)
and [us-invoicing-audit.md](us-invoicing-audit.md). That entire model asserts
that **the provider is the seller**. Destination charges would make Ruvik the
merchant of record, and therefore the seller for sales-tax purposes in every
state a provider works in — with none of the registrations that implies.

The cost of this choice is real and should be planned for: each provider needs
full KYC onboarding before they can take a card, which is heavier than the
recipient-only onboarding a marketplace would need.

### 2. The SaaS fee does *not* use `customer_account`

Stripe's Connect guidance says to bill connected accounts by passing
`customer_account` rather than creating a v1 Customer. That guidance does not
apply here, for three reasons found in
[the source doc](https://docs.stripe.com/connect/saas/tasks/service-fee):

1. It requires the account to hold **both** the `merchant` and `customer`
   configurations with `card_payments` **active** — i.e. completed KYC. A
   provider has to be able to subscribe on their first day, before any of that.
2. Its purpose is collecting the fee from the connected account's **Stripe
   balance**. A new provider has no balance.
3. The documented examples run on `Stripe-Version: 2025-04-30.preview`. A
   revenue path should not be pinned to a preview version.

So Flow A bills an ordinary v1 Customer by card, which is what
`providers.stripe_customer_id` in [006_stripe_billing.sql](../apps/api/src/db/migrations/006_stripe_billing.sql)
already provides. **No migration is needed when Phase 2 lands** — being billed
for a subscription and being a connected account are independent.

### 3. Restricted keys, not secret keys

Stripe's default recommendation is a restricted key (`rk_`). The current
environment schema validates `startsWith('sk_')`, which **rejects exactly the
key Stripe recommends**. Fixed in Phase 1.

### 4. Checkout and the Customer Portal, not a bespoke UI

`mode: 'subscription'` Checkout for signup; the Customer Portal for plan
changes, card updates and cancellation. This closes three gaps the audit found
— no proration, no stored card, "Switching without a gap is not available yet"
in the subscription screen — without building any of them.

Card details never touch Ruvik's servers, so the application stays out of PCI
scope.

---

## Phase 1 — Billing

### Stripe dashboard setup (manual, once)

1. Create a **sandbox** for development ([sandboxes](https://docs.stripe.com/sandboxes.md)),
   and a separate one for CI. Do not develop against the shared test mode.
2. Create **one Product per plan** — Starter, Pro, Business. Not one product
   with three prices: Checkout and invoices show the *product* name on each
   line item, so three tiers sharing a product are indistinguishable on a
   customer's invoice. `scripts/stripe-sync-plans.mjs` does this.
3. Enable the **Customer Portal** and allow plan switching between the three
   prices.
4. Create a **webhook endpoint** pointing at `POST /api/v1/webhooks/stripe`,
   subscribed to the events in the table below.
5. Mint a **restricted key** with write access to Checkout Sessions,
   Customers, Subscriptions, Billing Portal and read on Prices and Products.

### Environment

```bash
STRIPE_SECRET_KEY=rk_test_...      # restricted key preferred over sk_
STRIPE_WEBHOOK_SECRET=whsec_...    # the endpoint's signing secret, not the API key
```

Both are optional. Absent, `isStripeConfigured()` is false and the existing
manual flow keeps working unchanged — so an unconfigured deployment behaves
exactly as it does today.

### Webhook events

| Event | Intent | Why it matters |
|---|---|---|
| `checkout.session.completed` | `link_subscription` | The only event carrying `client_reference_id`, so it is where Stripe's ids get attached to a provider |
| `checkout.session.async_payment_succeeded` | `link_subscription` | Some payment methods settle later; without this, a delayed success never activates |
| `customer.subscription.created` / `.updated` / `.paused` / `.resumed` | `sync_subscription` | Status drives search visibility |
| `customer.subscription.deleted` | `end_subscription` | |
| `customer.subscription.trial_will_end` | `warn_trial_ending` | |
| `invoice.paid` | `record_payment` | Renewals. `invoice.paid` rather than `payment_succeeded` — it also fires for out-of-band payments |
| `invoice.payment_failed` | `payment_failed` | Opens the grace window |

Webhooks are not optional, and fulfilment belongs in the handler, not on the
success page. Subscription state changes happen asynchronously and after
checkout: renewals, failed payments and cancellations are invisible to an
integration that only reads the return URL.

### Two rules the code must keep

- **Never send `payment_method_types`.** Omitting it enables dynamic payment
  methods, configured from the dashboard. Hardcoding `['card']` locks out
  everything that converts better.
- **Activation stays webhook-only.** Already true of the manual flow and it
  must remain true: a forged return-URL hit must buy nothing.

### Grace windows must agree

Ruvik runs its own `GRACE_DAYS = 7` window via `billing.grace_expired`. Stripe
runs its own retry schedule. If Stripe is still retrying after Ruvik has
expired the subscription, a provider is delisted while their payment is still
in flight. Set Stripe's retry schedule to finish inside 7 days, or raise
`GRACE_DAYS` to match it.

---

## Phase 2 — Connect (not built yet)

Sketch only, so Phase 1 does not paint us into a corner.

1. `POST /v2/core/accounts` with `configuration.merchant` requesting
   `card_payments`, `dashboard: "full"`. Never the legacy
   `type: 'express' | 'custom' | 'standard'`.
2. Embedded onboarding (`account_onboarding` component) plus the
   `notification_banner` component — the latter is required to keep accounts
   healthy as Stripe's requirements evolve.
3. Gate every charge on
   `configuration.merchant.capabilities.card_payments.status === 'active'`.
   Never the deprecated `charges_enabled`.
4. Pay-this-invoice: a Checkout Session created **on the connected account**
   with `application_fee_amount` for Ruvik's cut.
5. New columns: `providers.stripe_account_id`, and a link from `payments` to
   the Stripe PaymentIntent.
6. This is what finally lets a customer pay an invoice online — the P0 the
   audit rated highest after subscriptions.

---

## Stripe Tax

Two separate questions, easy to conflate:

- **Sales tax the provider charges the homeowner.** Ruvik already records this
  per line and does not decide it. Stripe Tax is *not* involved, and must not
  be switched on for Flow B without a CPA deciding the nexus question first.
- **Tax on Ruvik's own subscription fee.** If Ruvik charges US or EU
  customers, this may need Stripe Tax on the Billing side. Note that
  `automatic_tax: { enabled: true }` collects **nothing** and reports **no
  error** until there is an active registration — the most common Stripe Tax
  mistake. Left off until somebody decides it deliberately. See
  [Collect taxes for recurring payments](https://docs.stripe.com/billing/taxes/collect-taxes.md).

---

## Testing

- `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe` for local
  delivery, and `stripe trigger <event>` to drive each intent.
- The signature verifier has unit tests already
  (`tests/unit/stripeBilling.test.ts`, 34 cases) and does not need a network.
- The sync layer is tested against synthesised event payloads, so the whole
  intent table is exercised without a Stripe account.
