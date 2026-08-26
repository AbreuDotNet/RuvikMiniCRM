# Test strategy

```
        ▲   E2E flows (33)          the nine required journeys, end to end
       ╱ ╲
      ╱   ╲  Security (51)          authz + attack suites
     ╱     ╲
    ╱       ╲ Integration (19)      PDF, queue, WhatsApp, idempotency, numbering
   ╱_________╲
  ╱           ╲ Unit (38)           money, pipeline, crypto, pagination
 ╱_____________╲
```

**141 tests, all green.** Every suite runs against embedded PostgreSQL, so
there is no service container to start and each run begins from a clean
schema — CI and a laptop behave identically.

```bash
npm test                  # everything
npm run test:security     # security suites only
npm run test:e2e          # journeys only
npm run test:watch
```

## Unit (38)

| File | Covers |
|---|---|
| `unit/money.test.ts` | Line maths, half-up rounding, proportional discount tax, negative/over-discount, integer-cent invariants |
| `unit/jobStatus.test.ts` | Legal transitions, terminal states, the new_lead→completed shortcut being refused |
| `unit/crypto.test.ts` | Argon2id round-trip, salting, malformed-hash safety, AES-GCM tamper detection, keyed HMAC, constant-time compare |
| `unit/pagination.test.ts` | Cursor round-trip, forged/injected/malformed cursors, page building |

## Integration (19)

`integration/infrastructure.test.ts` exercises the parts that touch real
subsystems:

- **PDF** — renders a genuine `%PDF-` file, stores it, and the recorded
  SHA-256 matches the stored bytes; served through a signed URL that a
  tampered expiry invalidates.
- **Queue** — retry with backoff then dead-letter; dedupe keys collapse
  duplicates; `SKIP LOCKED` prevents double delivery; orphaned jobs are
  reclaimed; future `run_at` is respected.
- **WhatsApp** — full consent lifecycle with an auditable history; opt-in
  refused without acknowledgement; E.164 validation; STOP keyword; and the
  message log provably contains neither the body nor the raw phone number.
- **Idempotency** — replay returns the original response, a different body
  under the same key is a conflict, keys are scoped per user.
- **Numbering** — sequential per provider, isolated across tenants, unique
  under eight concurrent creations.

## End-to-end (33)

`e2e/flows.test.ts` covers the nine required journeys:

| # | Flow | Cases |
|---|---|---|
| 1 | Customer registration and search | 4 |
| 2 | Provider onboarding and listings | 3 |
| 3 | Customer quote request | 2 |
| 4+5 | Quote creation, WhatsApp send, acceptance | 8 |
| 6 | Completion, invoicing, payment, review | 6 |
| 7 | Subscription payment and renewal | 4 |
| 8 | Admin moderation and suspension | 5 |
| 9 | Authorization failures | see security suites |

Notable assertions: a tampered total is ignored and recomputed; a draft quote
is invisible to the customer; a sent quote is frozen; invoicing an unaccepted
quote fails; suspension revokes sessions *immediately*; the audit chain
verifies after a run of admin actions and detects a tampered row.

## Security (51)

`security/authz.test.ts` (20) — BOLA/IDOR across clients, jobs, quotes,
invoices and list endpoints; 403-vs-404 indistinguishability; role boundaries;
MFA gating; self-suspension prevention; `alg:none` forgery; mass assignment
including self-verification and rating tampering.

`security/attacks.test.ts` (31) — SQL injection (5 payloads × 3 surfaces);
XSS storage and serving; control-character stripping; brute force and lockout;
account enumeration; weak passwords; refresh reuse detection; forged and
expired tokens; webhook spoofing (unsigned, forged, stale, body-modified);
upload abuse (type mismatch, SVG, polyglot, quarantine); signed-URL forgery,
traversal and expiry; body-size limits; rate limiting.

## Load

`loadtest/run.mjs` encodes the `docs/slo.md` budgets and exits non-zero on a
breach, so it gates CI. k6 profiles cover full-scale search, commerce, auth,
plus stress, spike and soak. See `loadtest/k6/README.md`.

Measured locally (20 VUs, 15s, embedded Postgres, single node):

```
requests      14687      throughput  977 req/s      error rate 0.00%
search p95     37ms      quote.create p95  38ms     dashboard p95  39ms
```

## What is not covered

- **Browser E2E.** Flows are proven at the API layer; the UI was verified by
  driving Chrome across all 25 screens in three roles. A Playwright suite is
  the natural next step for click-path regressions.
- **Real WhatsApp delivery.** The client is exercised in simulation mode;
  Meta's sandbox is needed for contract testing.
- **Real payment gateway.** The webhook contract is tested with signed
  fixtures; provider-specific behaviour needs their sandbox.
