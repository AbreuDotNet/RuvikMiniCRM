# Architecture

## Shape

```
                    ┌──────────────────────────────┐
   iOS / Android ──▶│  Web app (React + Vite)      │
   Mobile browser   │  mobile-first, role-routed   │
   Desktop admin ──▶└──────────────┬───────────────┘
                                   │ HTTPS, REST /api/v1
                    ┌──────────────▼───────────────┐
                    │  API (Express, stateless)    │   scale horizontally
                    │  authn · RBAC · validation   │
                    │  rate limits · audit         │
                    └───┬────────┬────────┬────────┘
                        │        │        │
              ┌─────────▼──┐ ┌───▼────┐ ┌─▼──────────────┐
              │ PostgreSQL │ │ Redis  │ │ Object storage │
              │ + job queue│ │ cache  │ │ private, signed│
              └─────────▲──┘ └────────┘ └────────────────┘
                        │
              ┌─────────┴──────────────┐
              │ Workers (own process)  │  scale independently
              │ PDF · WhatsApp · email │
              │ billing · reminders    │
              └────────────────────────┘
```

## Why these choices

**Stateless API.** No session affinity, nothing held in process memory that a
request depends on. Any instance can serve any request, so scaling is adding
instances behind the load balancer.

**PostgreSQL for the queue, not Redis.** A dropped invoice or an unsent quote
is a business incident, not a cache miss. Queue rows are written in the same
transaction as the record that caused them, so a job can never reference a
row that was rolled back. `FOR UPDATE SKIP LOCKED` lets many workers poll the
same table without contending.

Redis is used where losing data is survivable: rate-limit counters and cached
category lists. The platform runs correctly without Redis on a single node —
the cache falls back to an in-process map.

**Embedded PostgreSQL in development.** With no `DATABASE_URL` the API runs on
PGlite, real PostgreSQL 18 compiled to WebAssembly. The SQL, the migrations
and the schema are identical to production; there is no second dialect to
maintain. `npm run dev` needs no database server. Set `DATABASE_URL` and the
same code talks to a real cluster over `pg`.

**Money as integer cents.** Floating point cannot represent 0.10 exactly.
Every amount is an integer in minor units, and every total is recomputed
server-side from line items — a client-supplied total is never trusted.

## Request lifecycle

1. `requestContext` assigns a request id, echoed in logs and error bodies.
2. `helmet` sets security headers; CORS checks the origin against an allow-list.
3. Webhooks are routed **before** the JSON parser and keep their raw body,
   because a signature covers the exact bytes received.
4. `express.json` enforces the body-size limit.
5. `limiters.*` applies the per-bucket, per-subject rate limit.
6. `authenticate` verifies the JWT **and re-reads account status** — a
   suspended user loses access immediately, not when their token expires.
7. `requireRole` / `requireProvider` pin the tenant onto the request.
8. `validate(schema)` parses input allow-list style; unknown keys are dropped,
   which is what closes mass assignment.
9. The handler runs. Every provider-scoped query filters by the pinned tenant
   id, never by an id taken from the URL or body.
10. `writeAudit` appends to the hash-chained audit log for sensitive actions.
11. `errorHandler` maps the failure to a safe, stable error shape.

## Modules

| Module | Responsibility |
|---|---|
| `modules/auth` | Signup, login, MFA, refresh rotation, password reset |
| `modules/discovery` | Public search, categories, provider and service pages |
| `modules/provider` | Business profile, service listings, dashboard |
| `modules/crm` | Clients, jobs, notes, pipeline transitions, calendar |
| `modules/quotes` | Quote lifecycle and customer decisions |
| `modules/invoices` | Invoicing, payments, balances |
| `modules/customer` | Requests, request tracking, reviews |
| `modules/billing` | Plans, subscriptions, webhook-driven activation |
| `modules/whatsapp` | Consent, templates, dispatch, status, opt-out |
| `modules/notifications` | In-app notifications, the fallback channel |
| `modules/files` | Uploads, magic-byte validation, signed downloads |
| `modules/admin` | Moderation, verification, metrics, audit access |
| `modules/webhooks` | Signed billing and WhatsApp callbacks |

## Scaling path

| Stage | Change |
|---|---|
| Single node | Default. Embedded PG or one Postgres, in-process workers, memory cache |
| Growth | `DATABASE_URL` to a managed Postgres, `REDIS_URL` to a managed Redis, `WORKER_MODE=external` |
| Scale-out | N API instances behind a load balancer, M worker instances |
| Read pressure | Postgres read replica for search and public profiles |
| Global | CDN in front of the web app and object storage |

Every list endpoint uses keyset (cursor) pagination on `(created_at, id)`.
Offset pagination degrades badly past a few thousand rows, and these lists are
unbounded by design.

## Preventing N+1

Search and profile reads are single statements with joins, or a small fixed
number of parallel queries — never one query per row. `getPublicProvider`
issues exactly four queries regardless of how many services or reviews a
provider has.
