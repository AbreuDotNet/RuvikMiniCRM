# Deployment

## Prerequisites

| Component | Minimum | Notes |
|---|---|---|
| Node.js | 20.10 | LTS |
| PostgreSQL | 15 | 16+ preferred |
| Redis | 7 | Required once you run more than one API instance |
| Object storage | S3-compatible | Local disk works for a single node |
| TLS | — | Terminated at the load balancer; HSTS is set by the app |

## Configuration

Every value is validated at boot. In production the process **refuses to
start** without `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`, `HASH_PEPPER` and
`BILLING_WEBHOOK_SECRET`. See `.env.example` for the full list.

```bash
openssl rand -hex 32   # for each secret
```

Load them from a secrets manager (AWS Secrets Manager, GCP Secret Manager,
Vault) and inject as environment variables. Never commit them; gitleaks runs
in CI to enforce that.

### Rotating secrets

| Secret | Effect of rotation | Procedure |
|---|---|---|
| `JWT_ACCESS_SECRET` | All access tokens invalid | Rotate; clients refresh within 15 minutes |
| `ENCRYPTION_KEY` | **MFA secrets become undecryptable** | Requires a re-encryption migration — never rotate casually |
| `HASH_PEPPER` | Phone-hash correlation breaks | Historical `whatsapp_messages` correlation is lost; acceptable |
| `BILLING_WEBHOOK_SECRET` | Webhooks rejected | Coordinate with the payment provider; support both briefly |

## Local

```bash
npm install
npm run seed     # demo data; password RuvikDemo2026!
npm run dev      # API on :4000, web on :5173
```

No database server needed — the API runs on embedded PostgreSQL (PGlite).

## Production-shaped locally

```bash
docker compose up --build
docker compose up --scale worker=3   # scale the queue independently
```

## Deploying

```bash
# 1. Migrate first. Migrations must be backwards compatible with the
#    version still serving traffic, so a rollback does not break it.
DATABASE_URL=... npm run migrate

# 2. Roll out the new image.
docker build -t registry/ruvik-api:$SHA .
docker push registry/ruvik-api:$SHA
kubectl set image deployment/ruvik-api api=registry/ruvik-api:$SHA

# 3. Confirm readiness.
curl -fsS https://api.ruvik.app/ready
```

`.github/workflows/deploy.yml` performs this on a `v*` tag, gated by an
environment protection rule.

### Zero-downtime rules

- **Migrations are expand-then-contract.** Add a nullable column, deploy code
  that writes both, backfill, then drop the old column in a later release.
  Never rename or drop in the same deploy that stops using it.
- **SIGTERM is handled.** The server stops accepting connections, drains
  in-flight requests, then closes the pool. Give the orchestrator at least 20
  seconds of grace.
- **Workers are idempotent.** A job interrupted mid-flight is retried; PDF
  generation and WhatsApp sends both dedupe.

## Topology

```
            ┌────────── CDN ──────────┐        static web assets
            │                         │
   Clients ─┤                         └─▶ Object storage (private, signed URLs)
            │
            └─▶ Load balancer (TLS, WAF)
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        API instance N      API instance N+1     (stateless, autoscaled)
             │                   │
             └─────────┬─────────┘
                       ▼
        ┌──────────────┴──────────────┐
        ▼              ▼              ▼
   PostgreSQL      Redis         Worker pool     (scaled separately)
   (+ replica)     (cache)       WORKER_MODE=external
```

### Sizing for 100k customers

| Component | Start | Scale trigger |
|---|---|---|
| API | 3 × 1 vCPU / 1 GB | CPU > 60% sustained, or p95 > budget |
| Workers | 2 × 1 vCPU / 1 GB | Queue pending > 500 for 5 minutes |
| PostgreSQL | 4 vCPU / 16 GB | Connections > 70% of pool, or replica lag |
| Redis | 1 GB | Eviction rate above zero |

Login is the most CPU-hungry endpoint (Argon2id, 19 MiB per hash). Size the
API tier against expected peak login rate, not average request rate.

## Reverse proxy

Set `TRUST_PROXY` to the exact number of proxy hops you control. Too high and
a client can spoof `X-Forwarded-For` and evade the rate limiter.

```nginx
location /api/ {
    proxy_pass http://ruvik_api;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10m;   # above MAX_UPLOAD_BYTES
    proxy_read_timeout 30s;
}
```

## WhatsApp setup

1. Create a Meta Business account and a WhatsApp Business Platform app.
2. Register the sending number; note its phone number id.
3. Submit the four templates in `modules/whatsapp/service.ts` for approval —
   `ruvik_quote_ready`, `ruvik_invoice_ready`, `ruvik_job_scheduled`,
   `ruvik_payment_reminder`.
4. Set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, then `WHATSAPP_ENABLED=true`.
5. Point the webhook at `https://api.ruvik.app/api/v1/webhooks/whatsapp` and
   subscribe to `messages`.

Left disabled, the platform simulates sends so the whole consent → queue →
status → fallback path stays exercisable without contacting Meta.

## Backups

| What | How | Retention |
|---|---|---|
| PostgreSQL | Continuous archiving + PITR | 30 days |
| Object storage | Versioning + lifecycle | 90 days |
| Audit log | Included in PITR; verify the chain daily | 7 years |

Rehearse a restore quarterly. An unrehearsed backup is a hope, not a plan.

## Monitoring

Scrape RED metrics per route, queue depth and age, pool saturation, and
WhatsApp delivery outcomes. Alert on the conditions in `slo.md`.

Ship pino's JSON logs to the log platform. They are already redacted, so
they can be indexed without leaking credentials.

## Runbook: common incidents

**Queue backing up.** Check `/ready` for `queuePending`. Scale workers. If
one queue dominates, inspect `dead_letters` for a repeating error.

**Refresh failures spike.** Usually a client refreshing concurrently and
tripping reuse detection. Confirm the client serialises refresh through one
in-flight promise.

**Audit integrity fails.** Treat as a breach. Freeze admin access, capture the
database state, identify the first broken id via the integrity endpoint.

**WhatsApp failures.** The circuit breaker opens after 5 consecutive failures
and probes again after 60 seconds. In-app notifications continue regardless —
delivery is degraded, not lost.
