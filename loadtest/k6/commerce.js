import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { API, SLO_THRESHOLDS, jsonHeaders, signup } from './common.js';

/**
 * The money path: quote creation, retrieval and invoicing.
 *
 * Each VU provisions its own provider once in setup-per-VU, then loops the
 * flow. Write throughput here is what determines how many providers the
 * platform can serve concurrently at peak.
 */
export const options = {
  scenarios: {
    commerce: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { target: 25, duration: '1m' },
        { target: 75, duration: '2m' },
        { target: 75, duration: '3m' },
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: SLO_THRESHOLDS,
};

const sessions = {};

function ensureSession() {
  if (sessions[__VU]) return sessions[__VU];

  const account = signup('provider', 0);
  if (!account) return null;

  const client = http.post(
    `${API}/provider/clients`,
    JSON.stringify({ fullName: `K6 Client ${__VU}` }),
    { ...jsonHeaders(account.token), tags: { operation: 'client_create' } },
  );
  if (client.status !== 201) return null;

  const job = http.post(
    `${API}/provider/jobs`,
    JSON.stringify({ clientId: client.json('id'), title: `K6 job ${__VU}` }),
    { ...jsonHeaders(account.token), tags: { operation: 'job_create' } },
  );
  if (job.status !== 201) return null;

  sessions[__VU] = {
    token: account.token,
    clientId: client.json('id'),
    jobId: job.json('id'),
  };
  return sessions[__VU];
}

export default function () {
  const session = ensureSession();
  if (!session) return;

  group('dashboard', () => {
    const res = http.get(`${API}/provider/dashboard`, {
      ...jsonHeaders(session.token),
      tags: { operation: 'dashboard' },
    });
    check(res, { 'dashboard 200': (r) => r.status === 200 });
  });

  group('quote', () => {
    const res = http.post(
      `${API}/quotes`,
      JSON.stringify({
        jobId: session.jobId,
        lines: [
          { description: 'Diagnostic call-out', quantity: 1, unitPriceCents: 6500, taxRateBp: 1800 },
          { description: 'Labour', quantity: 2.5, unitPriceCents: 4500, taxRateBp: 1800 },
        ],
      }),
      { ...jsonHeaders(session.token), tags: { operation: 'quote_create' } },
    );
    check(res, {
      'quote 201': (r) => r.status === 201,
      // Totals must be computed server-side, never echoed from the client.
      'quote totals correct': (r) => r.json('totalCents') === 20945,
    });

    if (res.status === 201) {
      const read = http.get(`${API}/quotes/${res.json('id')}`, {
        ...jsonHeaders(session.token),
        tags: { operation: 'quote_read' },
      });
      check(read, { 'quote read 200': (r) => r.status === 200 });
    }
  });

  group('invoice', () => {
    const res = http.post(
      `${API}/invoices`,
      JSON.stringify({
        clientId: session.clientId,
        lines: [{ description: 'Completed work', quantity: 1, unitPriceCents: 25000, taxRateBp: 1800 }],
      }),
      { ...jsonHeaders(session.token), tags: { operation: 'invoice_create' } },
    );
    check(res, { 'invoice 201': (r) => r.status === 201 });
  });

  sleep(Math.random() * 3);
}
