# Threat model

Scope: the Ruvik API, web client, workers, database and object storage.
Method: STRIDE per trust boundary, prioritised by business impact.

## Assets

| Asset | Why it matters |
|---|---|
| Customer PII | Names, phones, addresses of people inviting a stranger into their home |
| Provider business data | Client book, pricing, revenue — commercially sensitive |
| Quotes and invoices | Financial instruments; alteration is fraud |
| Payment/subscription state | Directly monetisable |
| Credentials and tokens | Account takeover |
| WhatsApp consent records | Regulatory evidence; abuse risks platform access |
| Audit log | The record of who did what; must be trustworthy |

## Trust boundaries

1. Internet → API (untrusted input)
2. Payment provider → webhook (spoofable without signatures)
3. Meta/WhatsApp → webhook (same)
4. Provider tenant ↔ provider tenant (mutually untrusted)
5. Customer ↔ provider (contractual, not trusted)
6. API → object storage and database

---

## T1 — Unauthorised data access (BOLA/IDOR)

**Scenario.** A provider changes an id in a URL and reads another provider's
client list, quotes or invoices. The single highest-likelihood, highest-impact
flaw in a multi-tenant CRM.

**Controls.**
- The tenant id is pinned from the session by `requireProvider`, never read
  from the request.
- Every provider-scoped query carries `AND provider_id = $tenant`.
- Cross-tenant reads return **404, not 403**, so ids cannot be probed.
- Customer-facing reads filter on `customer_user_id` from the session.
- Internal job notes are excluded in the SQL, not filtered after fetching.

**Verified by.** `tests/security/authz.test.ts` — 11 cases across clients,
jobs, quotes, invoices, notes, list endpoints, and 403-vs-404 indistinguishability.

**Residual.** A new endpoint could omit the filter. Mitigation: `tenantId(req)`
is the only sanctioned accessor, and code review checks every new query.

---

## T2 — Account takeover

**Scenario.** Credential stuffing, brute force, phishing, or stealing a token.

**Controls.**
- Argon2id (m=19456, t=2, p=1) — OWASP-recommended parameters.
- NIST SP 800-63B password policy: 12+ characters, block list, no forced rotation.
- Lockout after 8 failures for 15 minutes.
- Uniform failure message and a real hash comparison on the miss path, so
  timing and content do not reveal whether an account exists.
- TOTP MFA, mandatory for admin state changes.
- Access tokens live 15 minutes; refresh tokens are single-use and rotated.
- **Refresh reuse revokes the whole family** — if an attacker and the real
  user both hold a token, the next rotation locks both out and the user
  re-authenticates.
- Password change or reset revokes every session.
- Account status is re-read on every request, so suspension is immediate.

**Verified by.** `tests/security/attacks.test.ts` — lockout, enumeration,
reuse detection, forged/expired tokens, `alg:none`.

**Residual.** MFA is optional for customers and providers. Accepted: forcing
it on a plumber signing up on a phone would cost more accounts than it saves.

---

## T3 — Invoice and quote fraud

**Scenario.** A tampered payload produces a $1 quote for $1,000 of work; or a
forwarded PDF is altered before the customer pays.

**Controls.**
- Totals are **always** recomputed server-side from line items; a
  client-supplied total is ignored.
- Quotes freeze on send — only drafts are editable.
- Invoices can only be raised from an **accepted** quote, and only once.
- Over-payment is rejected.
- Document numbers are allocated atomically per provider per year.
- Every PDF's SHA-256 is stored and printed in its footer, so a receiver can
  verify the copy they hold against the record.
- Quote/invoice mutations are audited.

**Verified by.** `tests/e2e/flows.test.ts` — tampered-total rejection,
un-accepted-quote invoicing, over-payment, frozen quotes, concurrent numbering.

---

## T4 — Payment webhook spoofing

**Scenario.** An attacker posts a forged `payment.succeeded` and gets a free
subscription — or replays a captured one.

**Controls.**
- HMAC-SHA256 over `<timestamp>.<raw body>`, compared in constant time.
- The timestamp is inside the signed payload and must be within 5 minutes.
- The raw body is verified before parsing, so re-serialisation cannot alter it.
- `webhook_events` has a unique `(source, external_id)` — a replay is a no-op.
- The paid amount must cover the plan price.
- **No human role can activate a subscription.** Only the webhook path can.

**Verified by.** `tests/security/attacks.test.ts` (unsigned, forged, stale,
body-modified) and `tests/e2e/flows.test.ts` (replay idempotency, short payment).

---

## T5 — Malicious uploads

**Scenario.** A "profile photo" that is a PHP shell, a polyglot carrying
script that becomes stored XSS, or a zip bomb.

**Controls.**
- Allow-list of JPEG, PNG, WebP, PDF — **SVG is deliberately excluded**
  because it can carry script.
- Magic-byte sniffing; a mismatch with the declared type is rejected outright.
- 8 MB cap enforced by the raw parser before the handler runs.
- Uploads are quarantined (`scan_status='pending'`) and excluded from public
  reads until scanned; the scanner deletes anything carrying markup or script.
- Storage keys are content-addressed and validated against traversal.
- Downloads are `Content-Disposition: attachment` with `nosniff`, never
  rendered inline.
- Files are private; access is via short-lived signed URLs only.

**Verified by.** `tests/security/attacks.test.ts` — type mismatch, SVG
rejection, quarantine lifecycle, polyglot detection, traversal, expiry.

---

## T6 — Injection (SQL, XSS, command, SSRF)

**Controls.**
- Every query is parameterised; no string concatenation of user input. Even
  the dynamic filter builder pushes values as parameters and only ever
  interpolates its own generated `$n` placeholders.
- Enum-constrained filters are validated by Zod before reaching SQL.
- The API is JSON-only with `nosniff` and a `default-src 'none'` CSP; it
  never renders HTML, so reflected XSS has no vector.
- Control characters are stripped from text that reaches PDFs, logs and CSV.
- No shell execution anywhere in the codebase.
- No user-supplied URL is fetched server-side; the only outbound calls are to
  the configured WhatsApp host.

**Verified by.** `tests/security/attacks.test.ts` — five injection payloads
across search, login and filters; XSS storage/serving; control-char stripping.

---

## T7 — Privilege escalation and mass assignment

**Scenario.** A signup payload carrying `role: "admin"`; a profile update
carrying `verificationStatus: "verified"`.

**Controls.**
- Zod parses allow-list style and the parsed output **replaces** the input, so
  undeclared keys never reach the data layer.
- Column maps are explicit — only named fields are writable.
- Role comes from the database, not the token, on every request.
- Rating and verification are derived or admin-only.

**Verified by.** `tests/security/authz.test.ts` — role escalation at signup,
self-verification, rating tampering, forged `provider_id`.

---

## T8 — Denial of service

**Controls.**
- Per-bucket, per-subject rate limits; financial and auth paths are tightest.
- 256 KB JSON limit, 8 MB upload limit.
- 15-second statement timeout.
- Connection pooling with a bounded maximum.
- Keyset pagination with a hard `limit` cap of 100 — no unbounded scans.
- Calendar range capped at 92 days.
- Circuit breaker on WhatsApp; queue backoff with dead-lettering.
- Under overload the platform sheds with 429/503 rather than failing.

**Residual.** A distributed L7 flood needs an edge WAF/CDN — out of scope for
the application tier. Documented in `deployment.md`.

---

## T9 — WhatsApp abuse and spam

**Scenario.** A provider harvests numbers and blasts marketing, risking the
platform's WhatsApp Business access.

**Controls.**
- Explicit opt-in with an affirmative acknowledgement; no pre-ticked boxes.
- Consent is checked **at send time**, not queue time — opting out while a job
  is queued stops the message.
- Only four pre-approved transactional templates can be sent. There is no
  free-text send API.
- Inbound STOP/UNSUBSCRIBE/BAJA opts out immediately.
- Per-provider hourly send cap.
- Full consent history retained as evidence.

---

## T10 — Provider impersonation

**Scenario.** Someone lists as an established local business to harvest
deposits.

**Controls.**
- Verification is an admin-only action requiring MFA, recorded in the audit log.
- The verified badge is the only trust signal shown; ratings derive from
  completed jobs, which require a real customer and a real job.
- Reviews cannot be left without a completed job.
- Suspension unpublishes listings and revokes sessions immediately.

**Residual.** Verification is a manual process. Its quality depends on the
operator actually checking documents; the platform enforces that only an
authenticated admin with MFA can record the decision.

---

## T11 — Audit tampering

**Scenario.** An insider deletes the record of their own action.

**Controls.**
- Append-only, hash-chained log; each row commits to the previous hash.
- No application code path issues `UPDATE` or `DELETE` on `audit_logs`.
- `GET /admin/audit-logs/integrity` re-walks the chain and reports the first
  broken row.
- Production hardening: a database role with `INSERT`-only grants on the table.

**Verified by.** `tests/e2e/flows.test.ts` — chain verifies after a run of
admin actions, and a directly tampered row is detected.

---

## T12 — Secret exposure

**Controls.**
- Secrets are read from the environment only; the process refuses to boot in
  production if any is missing.
- No API key ever reaches a mobile or web client — WhatsApp and billing calls
  are server-side only.
- Logs redact `authorization`, `cookie`, passwords, tokens and MFA secrets.
- MFA secrets are AES-256-GCM encrypted at rest.
- Phone numbers in the message log are masked and HMAC'd, never stored raw.
- Secret scanning (gitleaks) runs on every push.

---

## Coverage summary

| Threat | Primary control | Test |
|---|---|---|
| T1 BOLA/IDOR | Tenant filter in every query | `security/authz` |
| T2 Takeover | Argon2id, lockout, rotation, reuse detection | `security/attacks` |
| T3 Invoice fraud | Server-side totals, frozen documents, digests | `e2e/flows` |
| T4 Webhook spoofing | Signed + replay-protected + amount-checked | both |
| T5 Uploads | Magic bytes, quarantine, signed private URLs | `security/attacks` |
| T6 Injection | Parameterised SQL, JSON-only, CSP | `security/attacks` |
| T7 Escalation | Allow-list validation, DB-sourced role | `security/authz` |
| T8 DoS | Layered limits, timeouts, graceful shedding | `security/attacks` |
| T9 WhatsApp abuse | Consent at send time, template allow-list | `integration` |
| T10 Impersonation | MFA-gated verification, earned reviews | `e2e/flows` |
| T11 Audit tampering | Hash chain + integrity endpoint | `e2e/flows` |
| T12 Secrets | Env-only, redaction, encryption at rest | `unit/crypto` |
