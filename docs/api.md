# API contract

Base URL: `/api/v1`. JSON in, JSON out. The version is in the path; a
breaking change ships as `/api/v2` with `/api/v1` supported through a
published deprecation window.

## Authentication

`Authorization: Bearer <accessToken>` — a 15-minute HS256 JWT.

Refresh tokens are opaque, single-use, and rotated on every use:

- **Browsers** receive it as an `httpOnly; SameSite=Strict` cookie scoped to
  `/api/v1/auth`, so XSS cannot read it.
- **Native apps** receive it in the response body and store it in the OS
  keychain.

> Refresh tokens are single-use. Two concurrent refreshes with the same token
> are indistinguishable from token theft, so the server revokes the entire
> token family. Clients must serialise refresh through one shared in-flight
> promise.

## Error shape

Every failure has the same body:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields need your attention.",
    "details": [{ "field": "priceCents", "message": "Set a price for this pricing type." }]
  },
  "requestId": "0f7c…"
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed request |
| 401 | `unauthorized` | Missing, invalid or expired token |
| 403 | `forbidden` | Authenticated but not allowed |
| 404 | `not_found` | Absent **or** not yours (see note) |
| 409 | `conflict` | State conflict: already sent, already reviewed, over-payment |
| 413 | `payload_too_large` | Body or upload over the limit |
| 415 | `unsupported_media_type` | File type rejected |
| 422 | `validation_failed` | Field-level errors in `details` |
| 429 | `rate_limited` | `Retry-After` header included |
| 503 | `service_unavailable` | Dependency degraded |

> Cross-tenant reads return **404, not 403**. A 403 would confirm the record
> exists, letting an attacker enumerate ids.

## Pagination

Cursor-based on `(created_at, id)`:

```
GET /quotes?limit=20&cursor=MjAyNi0wOC0yNVQxMDowMDowMFp8M2Yx…
```

```json
{ "data": [ … ], "pagination": { "nextCursor": "…", "hasMore": true, "limit": 20 } }
```

## Idempotency

Money-moving endpoints accept `Idempotency-Key: <opaque>`. A retry with the
same key and body replays the original response (`Idempotent-Replay: true`);
the same key with a different body is a `409`.

Applies to: quote create/send/respond, invoice create/send/payment,
subscription checkout, customer requests.

## Rate limits

Per bucket, per subject (user id when authenticated, else client IP).

| Bucket | Window | Max | Applies to |
|---|---|---|---|
| `global` | 60s | 300 | All `/api/v1` |
| `auth` | 300s | 10 | Login, MFA verify |
| `refresh` | 300s | 60 | Token refresh |
| `signup` | 3600s | 5 | Registration |
| `pwreset` | 3600s | 5 | Password reset |
| `search` | 60s | 60 | Public discovery |
| `write` | 60s | 60 | General writes |
| `financial` | 60s | 20 | Quotes, invoices, payments, billing |
| `admin` | 60s | 100 | Admin surface |
| `whatsapp` | 3600s | 30 | Outbound messaging |
| `upload` | 3600s | 60 | File uploads |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

---

## Endpoints

### Auth — `/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/signup` | — | `role`: `customer` \| `provider` |
| POST | `/login` | — | May return `{ status: "mfa_required", mfaToken }` |
| POST | `/mfa/verify` | — | Exchanges `mfaToken` + TOTP for a session |
| POST | `/refresh` | cookie/body | Rotates; reuse revokes the family |
| POST | `/logout` | — | Revokes the presented token |
| POST | `/password/forgot` | — | Always `202`; never reveals account existence |
| POST | `/password/reset` | — | Consumes the token, revokes all sessions |
| POST | `/password/change` | any | Revokes all other sessions |
| POST | `/mfa/enroll` | any | Returns secret + otpauth URL |
| POST | `/mfa/confirm` | any | Returns one-time recovery codes |
| POST | `/mfa/disable` | any | Password-confirmed |
| GET | `/me` | any | Current user |

### Discovery — public

| Method | Path | Notes |
|---|---|---|
| GET | `/search/services` | `q`, `category`, `city`, `pricingType`, `minRating`, `maxPriceCents`, `verifiedOnly`, `sort`, `limit`, `cursor` |
| GET | `/categories` | Cached 120s |
| GET | `/providers/featured` | Ranked by rating, then volume |
| GET | `/providers/:slug` | Profile, active listings, reviews, portfolio |
| GET | `/services/:id` | Listing detail |

### Provider — `/provider` (role: provider)

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/profile` | Verification status and rating are **not** writable |
| GET | `/dashboard` | Leads, upcoming work, outstanding money, 6-month activity |
| GET/POST | `/services` | Plan listing limit enforced server-side |
| PATCH/DELETE | `/services/:id` | Tenant-scoped |
| GET/POST | `/clients` | `q` searches name, email, phone |
| GET/PATCH | `/clients/:id` | |
| GET/POST | `/jobs` | Filter by `status`, `clientId`, `q` |
| GET | `/jobs/:id` | Includes notes, quotes, invoices, timeline |
| POST | `/jobs/:id/status` | Rejects illegal transitions with `409` + `allowed` |
| POST | `/jobs/:id/notes` | `visibility`: `internal` \| `customer` |
| GET | `/calendar` | `from`, `to` (max 92 days) |

### Quotes — `/quotes`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/` | provider | Filter by `status`, `jobId` |
| POST | `/` | provider | Totals computed server-side from line items |
| PATCH | `/:id` | provider | Drafts only |
| POST | `/:id/send` | provider | Freezes, queues PDF, notifies, WhatsApp if opted in |
| GET | `/:id` | provider, customer | Drafts hidden from the customer |
| POST | `/:id/respond` | customer | `accept` \| `decline`; accepting approves the job |

### Invoices — `/invoices`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/` | provider | Includes outstanding/collected summary |
| POST | `/` | provider | `fromQuoteId` requires an **accepted** quote |
| POST | `/:id/send` | provider | |
| POST | `/:id/payments` | provider | Over-payment rejected with `409` |
| GET | `/:id` | provider, customer | |

### Customer — `/customer` (role: customer)

| Method | Path | Notes |
|---|---|---|
| GET | `/home` | Recent requests, unread count |
| GET/POST | `/requests` | Creates a lead in the provider's CRM |
| GET | `/requests/:id` | Internal provider notes are excluded at the query level |
| POST | `/requests/:id/review` | Completed jobs only, once per job |

### Billing — `/billing`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/plans` | public | |
| GET | `/subscription` | provider | Current plan and payment history |
| POST | `/subscription` | provider | Returns a checkout intent; **activation is webhook-only** |
| DELETE | `/subscription` | provider | `?immediate=true` to end now |

### Account — `/account` (any role)

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/profile` | |
| GET | `/whatsapp-consent` | |
| POST | `/whatsapp-consent` | Requires `acknowledged: true` |
| DELETE | `/whatsapp-consent` | Immediate opt-out |
| GET | `/export` | GDPR art. 20 portability |
| POST | `/delete` | Password + `"DELETE"` confirmation |

### Files — `/files`

| Method | Path | Notes |
|---|---|---|
| GET | `/download` | Signed, expiring URL; no session needed |
| POST | `/uploads` | Raw body; type verified by magic bytes; quarantined until scanned |
| DELETE | `/portfolio/:id` | |

### Admin — `/admin` (role: admin)

Reads need `aal1`; **every state change needs `aal=mfa`**.

| Method | Path | MFA | Notes |
|---|---|---|---|
| GET | `/metrics` | — | Users, revenue, activity, queue depth |
| GET | `/users` | — | `q`, `role`, `status` |
| POST | `/users/:id/status` | ✓ | Suspend/reinstate; reason required and audited |
| GET | `/providers` | — | Filter by verification status |
| POST | `/providers/:id/verification` | ✓ | |
| POST/PATCH | `/categories`, `/categories/:id` | ✓ | |
| GET | `/reviews` | — | |
| POST | `/reviews/:id/moderate` | ✓ | Recomputes the provider rating |
| GET | `/audit-logs` | — | |
| GET | `/audit-logs/integrity` | ✓ | Re-walks the hash chain |
| GET/POST | `/support-tickets` | — | |

### Webhooks — `/webhooks`

| Method | Path | Verification |
|---|---|---|
| POST | `/billing` | `X-Ruvik-Signature: t=<unix>,v1=<hmac>`; 5-minute window; replay-protected |
| GET | `/whatsapp` | Meta subscription handshake |
| POST | `/whatsapp` | `X-Hub-Signature-256` HMAC over the raw body |

### Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness — process is up |
| GET | `/ready` | Readiness — database and queue reachable; `503` when degraded |
