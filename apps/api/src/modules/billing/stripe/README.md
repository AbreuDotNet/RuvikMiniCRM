# Stripe subscription billing

Scaffold for charging providers their monthly plan through Stripe.

**Nothing here is wired into the running application.** `POST /billing/subscription`
still uses the manual flow in `../service.ts`. The switch-over is one explicit step,
listed below, taken when the keys exist. Until then the build is green, the tests pass,
and no provider is sent to a gateway that is not set up.

---

## What is in the folder

| File | What it is | Depends on |
|---|---|---|
| `config.ts` | Env vars, pinned API version, `isStripeConfigured()` | env |
| `signature.ts` | Webhook signature verification | `node:crypto` |
| `mapping.ts` | Stripe status → our status | nothing |
| `events.ts` | Which events we handle, and reading their payloads | nothing |
| `client.ts` | Minimal REST client: form encoding, idempotency, timeouts | `fetch` |
| `checkout.ts` | Checkout Session, Billing Portal, read a subscription | `client.ts` |
| `index.ts` | The public surface | — |

`mapping.ts`, `events.ts` and `signature.ts` are pure and have no imports beyond Node
built-ins, which is why they are the ones under test
(`tests/unit/stripeBilling.test.ts`, 34 cases). Everything that needs a network is behind
`client.ts`.

## No SDK, and why

This integration calls three endpoints: create a Checkout Session, create a Billing Portal
session, read a subscription. The two things the official SDK is genuinely worth having
for are handled here:

- **Signature verification** — `signature.ts`, twenty lines of the same HMAC scheme the
  repository already verifies for its own billing webhook.
- **Typed events** — `events.ts` types only the fields actually read. Hand-typing the whole
  of Stripe's objects would be wrong within a release and invites consuming fields nobody
  checked.

If you would rather use `npm i stripe`, it is a change to `client.ts` alone — the rest of
the folder talks to the functions it exports, not to HTTP.

---

## Setting it up

### 1. Stripe dashboard

Create one **Product** per plan and one **Price** per product (recurring, monthly, USD).
Copy each price id (`price_…`).

Prices in Stripe are immutable. Changing what a plan costs means creating a new price and
pointing the plan at it; existing subscribers stay on the old price until they move. That
is the behaviour you want — it is also why `subscription_plans.stripe_price_id` is a plain
column and not a computed thing.

### 2. Link the plans

Migration `006_stripe_billing.sql` adds the columns. Fill them in:

```sql
UPDATE subscription_plans SET stripe_price_id = 'price_...' WHERE code = 'pro';
UPDATE subscription_plans SET stripe_price_id = 'price_...' WHERE code = 'business';
-- 'starter' is $0: leave it null. It never reaches Stripe.
```

The free plan does not go through Stripe at all. `startSubscription` activates a $0 plan
immediately, because no charge means no webhook is ever coming — see
`tests/integration/subscriptions.test.ts`.

### 3. Webhook endpoint

Add an endpoint at `POST https://<host>/api/v1/webhooks/stripe` and subscribe to exactly
the events in `SUBSCRIBED_EVENT_TYPES`:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.paused
customer.subscription.resumed
customer.subscription.deleted
customer.subscription.trial_will_end
invoice.paid
invoice.payment_failed
```

A test asserts this list matches the one the code handles. If they drift, an event is
handled in code and never delivered, and the failure mode is silence.

### 4. Environment

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...      # the endpoint's signing secret, not the API key
```

Both optional. Missing keys mean `isStripeConfigured()` returns false and the manual flow
stays in charge; nothing throws at boot.

### 5. Local testing

```
stripe login
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
stripe trigger checkout.session.completed
```

`stripe listen` prints its own `whsec_…`; use that one locally.

---

## What still has to be written

The folder stops at the boundary of the existing application on purpose — these are the
pieces that touch our tables, and they should be written against the real schema rather
than guessed at here:

1. **`POST /api/v1/webhooks/stripe`** in `modules/webhooks/routes.ts`. The existing
   `/billing` route is the template: it already records the event before processing so a
   replay is rejected by the unique index rather than charged twice, and
   `webhook_events.source` now accepts `'stripe'`. Use `verifyStripeSignature` and the raw
   body — `app.ts` already captures `req.rawBody`.

2. **A handler per intent** from `events.ts`:
   - `link_subscription` → write `providers.stripe_customer_id` and
     `subscriptions.stripe_subscription_id` from the checkout session's
     `client_reference_id`.
   - `sync_subscription` → `fetchSubscription`, then `toRuvikStatus`, then update status
     and period. Re-fetch rather than trusting the payload: Stripe does not guarantee
     webhook ordering, so a late `updated` can carry an older status than one already
     applied.
   - `record_payment` → insert into `payments` with `kind = 'subscription'`, store
     `stripe_invoice_url`, and claim a receipt number the way `recordPayment` does for
     client invoices.
   - `payment_failed` → `markPaymentFailed`, which already opens the grace window.

3. **Routing `startSubscription` to Checkout** when the plan has a `stripe_price_id` and
   Stripe is configured, falling back to the current behaviour otherwise.

4. **A "Manage billing" button** on `SubscriptionScreen.tsx` calling `createPortalSession`.
   This is what closes three gaps the MVP audit listed — plan change with proration, stored
   payment method, cancellation flow — without building any of them.

---

## Two decisions worth reading before you wire it up

### The grace window will collide with Stripe's dunning

We run our own seven-day grace window: a failed charge schedules
`billing.grace_expired`, which moves the subscription to `expired` and drops the provider
out of search (`GRACE_DAYS` in `../service.ts`).

Stripe runs its own retry schedule — Smart Retries, up to four attempts over about three
weeks by default — and only then moves the subscription to `unpaid` or cancels it.

Left alone, these fight: Stripe is still trying to collect on day 8 while we have already
taken the provider's listings down. Pick one:

- **Stripe owns dunning** (recommended). Shorten Stripe's retry schedule to fit inside
  seven days, or lengthen `GRACE_DAYS` to match Stripe's. Our job stays as a backstop for
  the case where a webhook never arrives.
- **We own dunning.** Turn Stripe's retries off and drive everything from our own job.
  More control, and you are then maintaining a dunning process.

`toRuvikStatus` already assumes the first: `unpaid` maps to `expired`, not `past_due`, so a
subscription Stripe has given up on does not get a second grace window on top of the one it
has already had.

### Card details never touch this server

Checkout and the Billing Portal are both Stripe-hosted. Collecting a card in our own form
would put this application in scope for PCI DSS. The redirect is not a shortcut — it is the
reason the scope stays small.

---

## Sales tax on the subscription itself

`automatic_tax` is **off** in `checkout.ts`. Whether Ruvik must charge sales tax on its own
subscription fee is a separate question from the sales tax a provider charges their clients,
it depends on where Ruvik has nexus and how SaaS is treated in each state, and it is not a
decision this folder should make silently. See `docs/us-invoicing-audit.md` — this one needs
a CPA before it is turned on.
