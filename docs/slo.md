# Service level objectives

Targets for a platform serving 100,000+ customer accounts. Measured at the
load balancer over a rolling 28-day window.

## Availability

| Service | Objective | Monthly error budget |
|---|---|---|
| API (read paths) | 99.9% | 43m 12s |
| API (write paths) | 99.9% | 43m 12s |
| Web app | 99.9% | 43m 12s |
| Background workers | 99.5% | 3h 39m |

Availability = requests not returning 5xx. A 429 is a successful rejection,
not an outage.

## Latency

p95, server-side, excluding client network.

| Operation | p95 | p99 | Rationale |
|---|---|---|---|
| Service search | 300ms | 800ms | Highest-volume path; users abandon slow search |
| Provider profile | 300ms | 800ms | Entry point to conversion |
| Provider dashboard | 400ms | 1000ms | Several aggregates, run in parallel |
| Quote create | 500ms | 1200ms | Transactional write with line items |
| Quote read | 250ms | 600ms | |
| Invoice create | 500ms | 1200ms | |
| Token refresh | 250ms | 600ms | Runs constantly on every client |
| Login | 1200ms | 2000ms | Argon2id is deliberately expensive |
| File download (signed) | 400ms | 1500ms | Size-dependent |

## Correctness and freshness

| Objective | Target |
|---|---|
| Error rate (5xx / total) | < 0.1% |
| Quote/invoice PDF available after send | 99% within 30s |
| In-app notification visible | Synchronous with the API response |
| WhatsApp accepted by Meta | 95% within 60s (given consent) |
| Background job started after enqueue | p95 < 5s |
| Queue drained after a load spike | Baseline within 5 minutes |
| Dead-letter rate | < 0.1% of jobs |

## Data durability

| Objective | Target |
|---|---|
| RPO (recovery point) | ≤ 5 minutes (PITR) |
| RTO (recovery time) | ≤ 1 hour |
| Backup restore rehearsal | Quarterly, documented |
| Audit chain integrity check | Daily, alerting on failure |

## Alerting

| Condition | Severity | Response |
|---|---|---|
| 5xx > 1% for 5 minutes | Page | Immediate |
| p95 latency > 2x budget for 10 minutes | Page | Immediate |
| `/ready` failing on > 1/3 of instances | Page | Immediate |
| Queue pending > 1,000 for 10 minutes | Page | Immediate |
| Dead-letter rate > 1% over 1 hour | Ticket | Same day |
| Audit chain integrity failure | Page | Immediate — treat as a breach |
| Failed logins > 10x baseline | Ticket | Same day — credential stuffing |
| WhatsApp failure rate > 20% over 30 minutes | Ticket | Same day |
| Subscription past_due spike | Ticket | Same day — often a gateway fault |
| Certificate expiry < 14 days | Ticket | Same day |

## Instrumentation

- **Structured logs** — JSON via pino, one line per request, carrying request
  id, user id, route, status and duration, with credentials redacted.
- **Metrics** — RED (rate, errors, duration) per route; queue depth, age and
  dead-letter count; database pool saturation; WhatsApp delivery outcomes.
- **Traces** — request id propagated through `X-Request-Id`, ready for
  OpenTelemetry export.
- **Audit** — a separate, immutable stream from application logs.

## Verifying the SLOs

`loadtest/run.mjs` encodes the latency budgets above and exits non-zero on a
breach, so a regression fails CI rather than reaching production. The k6
profiles (`loadtest/k6/`) validate the same budgets at full scale, plus
stress, spike and soak behaviour.
