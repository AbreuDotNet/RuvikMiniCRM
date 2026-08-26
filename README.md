# Ruvik

A mobile-first mini CRM and marketplace for independent service
professionals — plumbers, electricians, carpenters, HVAC technicians,
painters, cleaners.

Customers find a trusted local pro and request a quote. Providers run their
whole business from a phone: leads, clients, jobs, quotes, invoices and
payments. Admins keep the marketplace trustworthy.

---

## Quick start

```bash
npm install
npm run seed     # demo data
npm run dev      # API :4000 · web :5173
```

Open **http://localhost:5173** and use a demo chip on the sign-in screen.

| Role | Email | Password |
|---|---|---|
| Customer | `ana@ruvik.demo` | `RuvikDemo2026!` |
| Provider | `greenleaf@ruvik.demo` | `RuvikDemo2026!` |
| Admin | `admin@ruvik.demo` | `RuvikDemo2026!` |

**No database server required.** With no `DATABASE_URL`, the API runs on
embedded PostgreSQL (PGlite — real PostgreSQL 18 compiled to WebAssembly).
The SQL, schema and migrations are identical to production; set
`DATABASE_URL` and the same code talks to a real cluster.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | API and web with hot reload |
| `npm run seed` | Demo dataset (idempotent) |
| `npm run migrate` | Apply migrations |
| `npm test` | 141 tests |
| `npm run test:security` | Security suites only |
| `npm run typecheck` | Both workspaces |
| `npm run build` | Production build |
| `npm run worker` | Workers as a standalone process |
| `node loadtest/run.mjs` | Load test with SLO assertions |
| `docker compose up --build` | Production-shaped stack |

## What is built

### Customer
Search by keyword, category, city, price type and rating · provider profiles
with services, portfolio, working hours and reviews · request a quote ·
review and accept or decline quotes · track requests · view invoices ·
rate completed jobs · notification centre · WhatsApp consent controls ·
data export and account deletion.

### Provider
Dashboard with leads, upcoming work, outstanding money and six-month
activity · client CRM with search · job pipeline across eight states with
enforced transitions · internal notes and customer-facing comments ·
**quote builder that takes under two minutes** · branded PDF quotes and
invoices · payment recording with balances · calendar · service listings ·
business profile and verification · subscription and billing.

### Admin
Platform metrics — users, revenue, MRR, conversion, queue depth ·
provider verification · user suspension with immediate session revocation ·
review moderation that recomputes ratings · tamper-evident audit log with
an integrity check · support tickets.

### Platform
Argon2id passwords · TOTP MFA · refresh-token rotation with theft detection ·
RBAC with strict tenant isolation · per-endpoint rate limits ·
idempotency on money paths · signed webhooks with replay protection ·
durable Postgres-backed job queue with retries and dead-lettering ·
official WhatsApp Business API with consent enforcement ·
private object storage with signed expiring URLs ·
hash-chained audit log · light and dark themes · WCAG 2.2 AA.

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | Node 20, Express, TypeScript | Stateless, horizontally scalable |
| Database | PostgreSQL 15+ (PGlite embedded in dev) | One dialect everywhere |
| Queue | PostgreSQL `job_queue` + `SKIP LOCKED` | A lost invoice is an incident, not a cache miss |
| Cache / limits | Redis, optional | In-process fallback keeps single-node simple |
| Validation | Zod | Allow-list parsing closes mass assignment |
| Auth | jose (JWT) + `@node-rs/argon2` + otplib | |
| PDF | PDFKit | Branded, digest-stamped documents |
| Web | React 18, Vite, React Router 7 | Mobile-first, no UI framework |
| Tests | Vitest + Supertest | |
| Load | Node harness + k6 | SLOs asserted in CI |

## Layout

```
apps/api/            Express API, workers, migrations, seed
  src/config         Validated environment
  src/db             Driver abstraction, migrations, seed
  src/lib            crypto · money · pdf · queue · storage · audit · cache
  src/middleware     auth · validate · rateLimit · idempotency · errors
  src/modules        auth · discovery · provider · crm · quotes · invoices
                     customer · billing · whatsapp · notifications · files
                     account · admin · webhooks
  src/workers        PDF, WhatsApp, email, billing, scanning
  tests              unit · integration · e2e · security
apps/web/            React app (customer, provider, admin)
docs/                architecture · data-model · api · rbac · threat-model
                     slo · testing · deployment · security-checklist
loadtest/            Node harness + k6 profiles
```

## Documentation

| Document | Contents |
|---|---|
| [architecture.md](docs/architecture.md) | Shape, request lifecycle, scaling path |
| [data-model.md](docs/data-model.md) | Schema, conventions, indexes |
| [api.md](docs/api.md) | Every endpoint, errors, pagination, limits |
| [rbac.md](docs/rbac.md) | Full permission matrix, tenant isolation |
| [threat-model.md](docs/threat-model.md) | 12 threats, controls, and the tests that prove them |
| [slo.md](docs/slo.md) | Availability, latency, alerting |
| [testing.md](docs/testing.md) | Strategy and coverage |
| [deployment.md](docs/deployment.md) | Config, topology, sizing, runbook |
| [security-checklist.md](docs/security-checklist.md) | Pre-release gate |

## A few decisions worth knowing

**Totals are always computed server-side.** A client-supplied total is
ignored. A tampered payload cannot turn $1,000 of work into a $1 quote.

**Cross-tenant reads return 404, not 403.** A 403 confirms the record exists
and lets an attacker enumerate ids.

**Only a signed webhook can activate a subscription.** No human role can —
not even an admin — so a forged success callback buys nothing.

**Refresh tokens are single-use.** Presenting a rotated token is treated as
theft and revokes the whole family. Clients must serialise refresh through
one in-flight promise; `apps/web/src/lib/api.ts` shows the pattern.

**WhatsApp consent is checked at send time, not queue time.** Opting out
while a message sits in the queue stops it. The message log stores no bodies
and no raw phone numbers.

**The audit log is hash-chained.** Each row commits to the previous one, so
deleting or editing history is detectable — and there is an endpoint that
checks.

## Status

Everything described here runs. 141 tests pass, the load harness meets every
SLO, `npm audit` is clean across both workspaces, and all 25 screens were
verified by driving a real browser in all three roles.

Two integrations are wired to their real contracts but exercised in
simulation, because they need third-party credentials: **WhatsApp Business**
(set `WHATSAPP_ENABLED=true` with Meta credentials) and the **payment
gateway** (the signed-webhook contract is implemented and tested; connect
your provider's checkout to it). Email delivery is queued through the same
worker contract and needs a transport configured.
