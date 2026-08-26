# Pre-release security checklist

Run before every production release. Any unchecked item blocks the release.

## Automated gates (CI must be green)

- [ ] `npm run typecheck` — no type errors
- [ ] `npm test` — full suite green
- [ ] `npm run test:security` — authz + attack suites green
- [ ] `npm audit --audit-level=moderate` — no findings
- [ ] Gitleaks — no secrets in history
- [ ] CodeQL (`security-extended`) — no new alerts
- [ ] Trivy image scan — no HIGH/CRITICAL
- [ ] ZAP baseline — no new FAIL-rated findings
- [ ] Load smoke test — no p95 SLO breach

## Authentication and sessions

- [ ] Argon2id parameters unchanged (m=19456, t=2, p=1)
- [ ] Access token TTL ≤ 15 minutes
- [ ] Refresh rotation on, reuse revokes the family
- [ ] Password change/reset revokes all sessions
- [ ] Lockout active (8 attempts / 15 minutes)
- [ ] Login and reset responses do not reveal account existence
- [ ] MFA enforced on admin state changes
- [ ] Account status re-checked per request

## Authorization

- [ ] Every new endpoint has an explicit role guard
- [ ] Every provider-scoped query filters on `tenantId(req)`
- [ ] No id from a URL or body is used as a tenant selector
- [ ] Cross-tenant reads return 404, not 403
- [ ] New fields reviewed for mass assignment
- [ ] Internal notes excluded from customer responses at the query level

## Input and output

- [ ] Every endpoint validates with a Zod schema
- [ ] No string interpolation of user input into SQL
- [ ] Responses are JSON with `nosniff`
- [ ] CSP unchanged and restrictive
- [ ] Uploads restricted to the magic-byte allow-list (no SVG)
- [ ] Uploads quarantined until scanned
- [ ] Downloads are `attachment`, private, signed and expiring

## Money and integrity

- [ ] Totals recomputed server-side; client totals ignored
- [ ] Documents immutable after send
- [ ] Invoices only from accepted quotes, once each
- [ ] Over-payment rejected
- [ ] Webhooks signature-verified, replay-protected, amount-checked
- [ ] Subscription activation reachable only via webhook
- [ ] Idempotency keys honoured on financial endpoints

## Privacy and compliance

- [ ] WhatsApp opt-in requires affirmative acknowledgement
- [ ] Consent re-checked at send time
- [ ] STOP handling verified
- [ ] Message log stores no message bodies; phones masked and hashed
- [ ] Data export returns only the caller's own records
- [ ] Deletion anonymises while retaining statutory financial records
- [ ] Logs redact credentials, tokens and MFA secrets

## Operations

- [ ] Production secrets present in the secrets manager, absent from the repo
- [ ] `TRUST_PROXY` matches the actual proxy depth
- [ ] Migrations are backwards compatible with the running version
- [ ] Rollback rehearsed
- [ ] Alerts firing to a monitored channel
- [ ] Backup restore rehearsed within the last quarter
- [ ] Audit chain integrity check passing

## Sign-off

| Role | Name | Date |
|---|---|---|
| Engineer | | |
| Reviewer | | |
| Release owner | | |
