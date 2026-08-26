# Data model

PostgreSQL 15+. Full DDL: `apps/api/src/db/migrations/001_init.sql`.

## Entity map

```
users ──1:1── providers ───┬──< services >── categories
  │                        ├──< clients ──< jobs ──┬──< quotes ──< quote_items
  │                        │                       ├──< invoices ──< invoice_items
  │                        │                       ├──< job_notes
  │                        │                       └──< job_status_events
  │                        ├──< subscriptions ── subscription_plans
  │                        └──< provider_portfolio_images ── files
  ├──1:1── customer_profiles
  ├──< reviews (one per job)
  ├──< notifications
  ├──< whatsapp_consents / whatsapp_messages
  └──< refresh_tokens
```

## Conventions

| Rule | Reason |
|---|---|
| Money is `integer` cents | Floats cannot represent 0.10; rounding errors become billing disputes |
| Timestamps are `timestamptz` | Providers and customers can be in different zones |
| Enums are `text` + `CHECK` | Adding a value is a migration, not a type rewrite with locks |
| Every provider-owned table has `provider_id` | Tenant isolation is enforceable in a `WHERE` clause |
| Soft delete via `status` / `deleted_at` | Financial records must survive an account deletion |

## Key tables

### users
One row per human. `role` is one of `admin`, `provider`, `customer` and is the
source of truth — the JWT's role claim is re-checked against this on every
request. Case-insensitive email uniqueness is a `UNIQUE INDEX` on
`lower(email)` filtered to non-deleted rows, avoiding the `citext` extension.

WhatsApp consent lives here as current state (`whatsapp_opt_in`,
`whatsapp_opt_in_at`, `whatsapp_opt_out_at`), with the full history in
`whatsapp_consents`.

### providers
The business. `slug` is the public URL key. `rating_avg` / `rating_count` are
denormalised for search performance and **recomputed from `reviews`** whenever
a review is created or moderated — never incrementally adjusted, which would
drift.

`search_doc` is a generated `tsvector` column, indexed with GIN.

### services
A listing. The `services_price_coherent` CHECK enforces that `request_quote`
listings carry no price and `fixed`/`starting_at` listings must. The API
mirrors this rule in Zod so the user gets a field-level message rather than a
constraint violation.

### jobs
The central CRM entity — a lead, a booking and a completed job are all one
row moving through `status`. Legal transitions are defined in
`modules/crm/jobStatus.ts`, not left to the UI, so a client cannot jump
straight to `completed` and unlock reviewing and invoicing.

`reference` is unique per provider (`JOB-2026-0001`).

### quotes / invoices
Immutable once sent. A quote in `draft` is the provider's working copy and is
invisible to the customer; sending freezes the figures and mints a share
token (only its hash is stored).

`pdf_sha256` is the digest of the generated PDF, printed in the document
footer, so a forwarded copy can be checked against the record on file.

Numbering is per provider per year via `number_sequences`, allocated with
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside the caller's
transaction — two concurrent quote creations cannot claim the same number.

### audit_logs
Append-only and hash-chained: each row's `hash` covers the previous row's
`hash`. Deleting or editing history breaks the chain, which
`GET /admin/audit-logs/integrity` detects. No application code ever issues an
`UPDATE` or `DELETE` against this table.

### job_queue
Durable background work. Partial unique index on `dedupe_key` collapses
duplicate jobs (one PDF render per quote). Failed jobs get exponential
backoff with jitter, then move to `dead_letters`.

### whatsapp_messages
Deliberately stores **no message body** — only the template name, a masked
phone (`+1809*****42`), an HMAC of the number for correlation, and delivery
status. A database compromise does not reveal what was sent to whom.

## Indexes that matter

| Index | Serves |
|---|---|
| `services_search_idx` (GIN) | Full-text service search |
| `providers_search_idx` (GIN) | Provider name/bio search |
| `services_active_created_idx` | Keyset pagination of the catalogue |
| `jobs_provider_status_idx` | The provider's pipeline board |
| `invoices_due_idx` (partial) | The overdue-invoice sweep |
| `job_queue_poll_idx` | Worker polling |
| `subscriptions_one_live_per_provider` (partial unique) | At most one live subscription |
| `clients_provider_user_uniq` (partial unique) | One client record per (provider, customer) |
