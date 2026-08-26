#!/usr/bin/env node
/**
 * Ruvik load harness — dependency-free.
 *
 * Drives the critical flows concurrently and reports latency percentiles,
 * throughput and error rate against the SLOs in docs/slo.md.
 *
 *   node loadtest/run.mjs --base http://localhost:4000 --vus 40 --duration 30
 *
 * The API must be started with RATE_LIMIT_ENABLED=false, otherwise the
 * limiter (correctly) rejects synthetic traffic and the numbers measure the
 * limiter rather than the application.
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const BASE = args.base ?? 'http://localhost:4000';
const VUS = Number(args.vus ?? 25);
const DURATION_S = Number(args.duration ?? 20);
const SCENARIO = args.scenario ?? 'all';

/* --------------------------------- SLOs ---------------------------------- */

const SLO = {
  'auth.login':        { p95: 1200, note: 'Argon2id is deliberately slow' },
  'auth.refresh':      { p95: 250 },
  'search.services':   { p95: 300 },
  'provider.profile':  { p95: 300 },
  'provider.dashboard':{ p95: 400 },
  'quote.create':      { p95: 500 },
  'quote.read':        { p95: 250 },
  'invoice.create':    { p95: 500 },
  'notifications.list':{ p95: 250 },
};
const MAX_ERROR_RATE = 0.01;

/* ------------------------------- metrics --------------------------------- */

const metrics = new Map();

function record(name, ms, ok) {
  let m = metrics.get(name);
  if (!m) {
    m = { samples: [], errors: 0, count: 0 };
    metrics.set(name, m);
  }
  m.count += 1;
  if (ok) m.samples.push(ms);
  else m.errors += 1;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function timed(name, fn) {
  const started = performance.now();
  try {
    const result = await fn();
    record(name, performance.now() - started, true);
    return result;
  } catch (err) {
    record(name, performance.now() - started, false);
    throw err;
  }
}

/* -------------------------------- client --------------------------------- */

async function call(path, { method = 'GET', body, token, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!expect.includes(res.status)) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  }
  return res.status === 204 ? null : res.json();
}

const PASSWORD = 'LoadTest-Passphrase-9';
const KEYWORDS = ['plumber', 'air conditioner', 'electrical', 'carpentry', 'leak', 'paint', ''];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/* ------------------------------- scenarios -------------------------------- */

/** Anonymous discovery: the highest-volume traffic on a marketplace. */
async function browseScenario() {
  await timed('search.services', () =>
    call(`/search/services?limit=20&q=${encodeURIComponent(pick(KEYWORDS))}`));

  const featured = await timed('provider.profile', () => call('/providers/featured?limit=10'));
  if (featured?.data?.length) {
    const provider = pick(featured.data);
    await timed('provider.profile', () => call(`/providers/${provider.slug}`));
  }
}

/** A signed-in customer checking on their requests. */
async function customerScenario(session) {
  await timed('notifications.list', () =>
    call('/notifications?limit=20', { token: session.token }));
  await timed('search.services', () =>
    call('/search/services?limit=20&sort=rating', { token: session.token }));
  await timed('provider.dashboard', () =>
    call('/customer/requests?limit=20', { token: session.token }));
}

/** A provider working through the money-making path. */
async function providerScenario(session) {
  await timed('provider.dashboard', () =>
    call('/provider/dashboard', { token: session.token }));

  const quote = await timed('quote.create', () =>
    call('/quotes', {
      method: 'POST',
      token: session.token,
      body: {
        jobId: session.jobId,
        lines: [
          { description: 'Load test line item', quantity: 1, unitPriceCents: 12000, taxRateBp: 1800 },
          { description: 'Labour', quantity: 2, unitPriceCents: 4500, taxRateBp: 1800 },
        ],
      },
    }));

  await timed('quote.read', () => call(`/quotes/${quote.id}`, { token: session.token }));

  await timed('invoice.create', () =>
    call('/invoices', {
      method: 'POST',
      token: session.token,
      body: {
        clientId: session.clientId,
        lines: [{ description: 'Load test invoice', quantity: 1, unitPriceCents: 25000, taxRateBp: 1800 }],
      },
    }));
}

/** Token rotation, which every long-lived client performs continuously. */
async function refreshScenario(session) {
  const refreshed = await timed('auth.refresh', () =>
    call('/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } }));
  session.token = refreshed.accessToken;
  session.refreshToken = refreshed.refreshToken;
}

/* -------------------------------- setup ----------------------------------- */

async function provisionProvider(index) {
  const email = `lt-provider-${Date.now()}-${index}@loadtest.local`;
  const signup = await timed('auth.login', () =>
    call('/auth/signup', {
      method: 'POST',
      expect: [201],
      body: {
        email, password: PASSWORD, fullName: 'Load Provider',
        role: 'provider', businessName: `Load Test Co ${index}`, city: 'Santo Domingo',
      },
    }));

  const client = await call('/provider/clients', {
    method: 'POST', token: signup.accessToken, expect: [201],
    body: { fullName: `Load Client ${index}` },
  });

  const job = await call('/provider/jobs', {
    method: 'POST', token: signup.accessToken, expect: [201],
    body: { clientId: client.id, title: `Load job ${index}` },
  });

  return {
    role: 'provider',
    token: signup.accessToken,
    refreshToken: signup.refreshToken,
    clientId: client.id,
    jobId: job.id,
  };
}

async function provisionCustomer(index) {
  const email = `lt-customer-${Date.now()}-${index}@loadtest.local`;
  const signup = await timed('auth.login', () =>
    call('/auth/signup', {
      method: 'POST',
      expect: [201],
      body: {
        email, password: PASSWORD, fullName: 'Load Customer',
        role: 'customer', city: 'Santo Domingo',
      },
    }));
  return { role: 'customer', token: signup.accessToken, refreshToken: signup.refreshToken };
}

/* --------------------------------- run ------------------------------------ */

async function main() {
  console.log(`Ruvik load test → ${BASE}`);
  console.log(`  virtual users: ${VUS}   duration: ${DURATION_S}s   scenario: ${SCENARIO}\n`);

  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API is not reachable at ${BASE}. Start it first.`);
    process.exit(1);
  }

  console.log('Provisioning virtual users…');
  const providerCount = Math.max(1, Math.floor(VUS / 3));
  // One customer per VU: a refresh token is single-use, so two workers
  // sharing a session would trip the server's token-reuse detection and
  // measure that defence rather than the platform's throughput.
  const customerCount = VUS;

  const sessions = { providers: [], customers: [] };
  await Promise.all([
    ...Array.from({ length: providerCount }, (_, i) =>
      provisionProvider(i).then((s) => sessions.providers.push(s)).catch(() => undefined)),
    ...Array.from({ length: customerCount }, (_, i) =>
      provisionCustomer(i).then((s) => sessions.customers.push(s)).catch(() => undefined)),
  ]);

  if (!sessions.providers.length || !sessions.customers.length) {
    console.error('Could not provision users. Is RATE_LIMIT_ENABLED=false?');
    process.exit(1);
  }
  console.log(`  ${sessions.providers.length} providers, ${sessions.customers.length} customers\n`);

  const deadline = Date.now() + DURATION_S * 1000;
  let iterations = 0;
  const startedAt = performance.now();

  const worker = async (id) => {
    while (Date.now() < deadline) {
      try {
        const roll = Math.random();
        if (SCENARIO === 'browse' || (SCENARIO === 'all' && roll < 0.45)) {
          await browseScenario();
        } else if (SCENARIO === 'customer' || (SCENARIO === 'all' && roll < 0.7)) {
          await customerScenario(sessions.customers[id % sessions.customers.length]);
        } else if (SCENARIO === 'provider' || (SCENARIO === 'all' && roll < 0.95)) {
          await providerScenario(sessions.providers[id % sessions.providers.length]);
        } else {
          // Each VU rotates only the session it exclusively owns.
          const own = sessions.customers[id];
          if (own) await refreshScenario(own);
        }
        iterations += 1;
      } catch {
        // Errors are already recorded by timed(); keep the VU running.
      }
    }
  };

  console.log('Running…');
  await Promise.all(Array.from({ length: VUS }, (_, i) => worker(i)));

  const elapsedS = (performance.now() - startedAt) / 1000;
  report(elapsedS, iterations);
}

function report(elapsedS, iterations) {
  console.log(`\n${'='.repeat(86)}`);
  console.log('RESULTS');
  console.log('='.repeat(86));
  console.log(
    'operation'.padEnd(22) + 'n'.padStart(7) + 'err'.padStart(6) +
    'p50'.padStart(9) + 'p95'.padStart(9) + 'p99'.padStart(9) +
    'max'.padStart(9) + '   SLO',
  );
  console.log('-'.repeat(86));

  let totalRequests = 0;
  let totalErrors = 0;
  let breached = 0;

  for (const [name, m] of [...metrics.entries()].sort()) {
    const sorted = [...m.samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const max = sorted[sorted.length - 1] ?? 0;

    totalRequests += m.count;
    totalErrors += m.errors;

    const budget = SLO[name]?.p95;
    let verdict = '';
    if (budget) {
      const pass = p95 <= budget;
      if (!pass) breached += 1;
      verdict = `${pass ? 'PASS' : 'FAIL'} (<=${budget}ms)`;
    }

    console.log(
      name.padEnd(22) +
      String(m.count).padStart(7) +
      String(m.errors).padStart(6) +
      `${p50.toFixed(0)}ms`.padStart(9) +
      `${p95.toFixed(0)}ms`.padStart(9) +
      `${p99.toFixed(0)}ms`.padStart(9) +
      `${max.toFixed(0)}ms`.padStart(9) +
      `   ${verdict}`,
    );
  }

  const errorRate = totalRequests ? totalErrors / totalRequests : 0;
  console.log('-'.repeat(86));
  console.log(`requests      ${totalRequests}`);
  console.log(`iterations    ${iterations}`);
  console.log(`throughput    ${(totalRequests / elapsedS).toFixed(1)} req/s`);
  console.log(`error rate    ${(errorRate * 100).toFixed(2)}%  (budget ${(MAX_ERROR_RATE * 100).toFixed(0)}%)`);

  const errorsOk = errorRate <= MAX_ERROR_RATE;
  console.log('='.repeat(86));

  if (breached === 0 && errorsOk) {
    console.log('PASS — every operation met its latency SLO and the error budget held.');
    process.exit(0);
  }
  console.log(`FAIL — ${breached} latency SLO breach(es); error budget ${errorsOk ? 'held' : 'exceeded'}.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
