# Plans and entitlements

What each subscription tier includes, how the limits are enforced, and what
the admin can change without a deploy.

---

## The launch catalogue

| | Starter | Pro | Business |
|---|---|---|---|
| Price | **Free** | **$14.99 / month** | **$29.99 / month** |
| Clients | 10 | Unlimited | Unlimited |
| Receipts | 20 a month | Unlimited | Unlimited |
| Listings | 3 | 25 | Unlimited |
| Quotes | 15 a month | Unlimited | Unlimited |
| Seats | 1 | 1 | 5 |
| Export tax reports | — | ✓ | ✓ |
| Estimated quarterly taxes | — | ✓ | ✓ |
| Priority support | — | ✓ | ✓ |
| Assistants and employees | — | — | ✓ |
| Automatic payment recording | — | — | ✓ |
| Advanced cloud backup | — | — | ✓ |

Two prices are decisions rather than transcriptions, and both are one admin
edit away from changing:

- **Starter is $0, not $4.99.** The brief allowed either. No payment gateway
  is wired yet, and a priced entry tier would mean nobody can finish
  onboarding: a free plan activates immediately, a priced one waits for a
  webhook that is not coming. Set the price the day billing goes live.
- **Pro is $14.99**, the middle of the $12.99–$19.99 range. A starting point
  to test against.

`maxTeamMembers` on Business is 5 rather than the literal "one assistant". The
capability is what the plan sells; the seat count is a knob.

---

## How a limit is enforced

One module answers "what can this provider do?" for the whole API:
[`apps/api/src/modules/billing/entitlements.ts`](../apps/api/src/modules/billing/entitlements.ts).

Everything else asks it. That is deliberate: `max_quotes_per_month` sat in the
schema from the first migration until now **without a single caller ever
reading it** — every plan advertised a quote limit and no plan had one. A
limit that lives in one place is a limit that gets checked.

Two rules hold everywhere:

- **`null` is unlimited.** Never zero — the database refuses zero, which reads
  as "unset" but means "nothing allowed" and would lock a paying customer out
  of what they bought.
- **No live subscription means the most restrictive active plan**, not "no
  limits". Failing open on a billing limit is how the free tier once ended up
  more generous than the paid one: a provider with no subscription row got
  unlimited listings while a paying one was capped at 25.

`past_due` still counts as live. That is the grace window, and cutting someone
off mid-grace would make the grace meaningless.

### Where the checks sit

| Limit | Enforced in | Notes |
|---|---|---|
| `max_clients` | `POST /provider/clients` **and** `POST /provider/jobs` | Two doors into the same table. A limit enforced on one is not enforced. |
| `max_receipts_per_month` | `recordPayment`, before any money is written | Refusing after recording would leave the invoice paid and the customer without the receipt they were handed. |
| `max_quotes_per_month` | `createQuote` | |
| `max_services` | `POST /provider/services` | |

The client check takes a `FOR UPDATE` lock on the provider row first. Without
it, two taps in quick succession both count nine and both insert, and a plan
that says ten quietly holds eleven.

Monthly quotas reset on the **calendar month**, not on the billing period: "20
a month" is what the plan says, and a quota that resets on a date the customer
cannot predict is a quota they cannot plan around.

### What an exhausted quota looks like

```json
{
  "error": {
    "code": "conflict",
    "message": "The Starter plan includes 10 clients. Upgrade your plan to add more.",
    "details": {
      "reason": "plan_limit_reached",
      "planCode": "starter",
      "limit": 10,
      "used": 10,
      "resource": "clients"
    }
  }
}
```

A **409**, not a 403: the plan covers this kind of action, there is simply no
allowance left — and unlike a capability it resolves itself next month or on
an upgrade. The numbers travel with the error so a client can render "10 of
10" without a second request.

---

## Capabilities

Boolean features, as a `text[]` with a CHECK against the known vocabulary. A
typo is rejected by the database rather than silently granting nothing:
`fiscal_report` instead of `fiscal_reports` must fail loudly, not quietly
withhold the feature the customer paid for. Adding one is a migration, which
is the point — it should be as hard to invent a capability as a column.

| Capability | Built? |
|---|---|
| `priority_support` | Operational, not a code path |
| `fiscal_reports` | **No** |
| `tax_estimates` | **No** |
| `team_members` | **No** — one user per provider today |
| `payment_gateway` | **No** — Stripe is scaffolded, not wired |
| `advanced_backup` | **No** |

`UNIMPLEMENTED_CAPABILITIES` names the gap, and both the admin panel and the
provider's subscription screen show it as "not built yet" / "Coming". That is
better than an app advertising a button it cannot build, and it means whoever
ships the feature will find the entitlement already waiting.

**The receipt quota counts payment receipts**, the numbered `RCP-` documents
issued when a payment is recorded. The plan copy describes uploading expense
receipts, which this product does not do yet; the quota is wired to the only
receipts that exist.

---

## Admin management

`/admin/plans` — read at `aal1`, **write needs a two-factor session**.

| Method | Path | MFA |
|---|---|---|
| GET | `/admin/plans` | — |
| POST | `/admin/plans` | ✓ |
| PATCH | `/admin/plans/:id` | ✓ |

The web panel screen is **Admin → Plans**.

The listing includes live and lifetime subscriber counts, because an admin
deciding whether to retire a tier needs to know who is standing on it.

Two things an admin deliberately cannot do:

- **Delete a plan.** The foreign key from `subscriptions` is `RESTRICT`, which
  is right: deleting would orphan the billing history of everyone who ever
  paid for it. Retiring hides it from signup and leaves existing subscribers
  where they are, at the price they agreed.
- **Retire the last active plan.** With none active there is nothing to sign
  up to and nothing for the entitlements fallback to resolve to.

A price change **does not touch anyone's current period**. Subscriptions carry
their own period dates; editing the catalogue changes what the next renewal
quotes. Both figures go into the audit trail under `admin.plan_updated`, so
"why did my bill change" has an answer with a date and an actor on it.

Changes take effect immediately. Entitlements are read at the moment of the
action, so raising a limit frees the provider on their next tap — no
re-subscribe, no cache to bust. There is a live test for exactly that.

---

## For the apps

`GET /provider/entitlements` returns the plan, the limits, the capabilities
and current usage, served by the same module that does the enforcing — so what
a screen shows and what the server refuses on cannot drift apart.

```jsonc
{
  "plan": { "code": "starter", "name": "Starter" },
  "subscriptionStatus": null,
  "fromLiveSubscription": false,   // limits come from the fallback
  "limits": { "maxClients": 10, "maxReceiptsPerMonth": 20, "maxTeamMembers": 1 },
  "capabilities": [],
  "unimplemented": [],
  "usage": {
    "clients": { "used": 7, "limit": 10, "exhausted": false }
  }
}
```

Mobile renders it on the subscription screen through
`src/features/billing/PlanUsage.tsx`.

---

## Tests

`apps/api/tests/integration/planEntitlements.test.ts` — 15 cases covering each
quota, the inline-client back door, unlimited, the restrictive fallback, the
`past_due` grace, the usage endpoint, and the admin surface including the
MFA gate, the capability vocabulary and the last-active-plan guard.
