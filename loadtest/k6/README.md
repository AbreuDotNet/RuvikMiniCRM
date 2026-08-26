# Load testing

Two harnesses:

| Tool | File | Use |
|---|---|---|
| Node (no deps) | `../run.mjs` | Quick local check; runs in CI on every PR |
| k6 | `*.js` | Full-scale profiles against staging |

## Node harness

```bash
# The limiter must be off, or you measure the limiter and not the app.
RATE_LIMIT_ENABLED=false npm run dev:api
node loadtest/run.mjs --vus 40 --duration 30
```

Exits non-zero when any p95 breaches its SLO or the error budget is exceeded,
so it works as a CI gate.

## k6 profiles

```bash
brew install k6

k6 run -e BASE_URL=https://staging-api.ruvik.app loadtest/k6/search.js
k6 run -e BASE_URL=https://staging-api.ruvik.app loadtest/k6/commerce.js
k6 run -e BASE_URL=https://staging-api.ruvik.app loadtest/k6/auth.js

k6 run -e PROFILE=stress loadtest/k6/stress-spike-soak.js
k6 run -e PROFILE=spike  loadtest/k6/stress-spike-soak.js
k6 run -e PROFILE=soak   loadtest/k6/stress-spike-soak.js
```

## Sizing basis

Target: **100,000 customer accounts** plus their providers.

| Assumption | Value |
|---|---|
| Peak-hour active customers | 5% (5,000) |
| Searches per active session | ~6 |
| Sustained search rate | ~9 rps |
| Peak search rate (4x) | ~36 rps |
| Providers active at peak | ~1,500 |
| Quote writes at peak | ~3 rps |

`search.js` drives to 300 rps and `stress-spike-soak.js` to 1,000 rps —
roughly 8x and 25x the modelled peak, which is where the headroom for
growth and for regional traffic spikes is proven.

## What "pass" means

- No 5xx at any load. Shedding with 429/503 is a pass; a 500 is not.
- p95 within the budgets in `docs/slo.md`.
- Queue depth returns to baseline within 5 minutes of load stopping.
- Memory flat across the 1-hour soak (no upward trend).
