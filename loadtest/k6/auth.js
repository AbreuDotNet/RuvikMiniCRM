import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, SLO_THRESHOLDS, jsonHeaders, signup } from './common.js';

/**
 * Login and token rotation.
 *
 * Argon2id is deliberately expensive (19 MiB, t=2), so login is the most
 * CPU-hungry endpoint on the platform and needs its own capacity plan.
 * Refresh is measured separately because clients perform it continuously.
 */
export const options = {
  scenarios: {
    auth: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { target: 20, duration: '1m' },
        { target: 50, duration: '2m' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: SLO_THRESHOLDS,
};

const sessions = {};

export default function () {
  // Each VU owns exactly one session: refresh tokens are single-use, so a
  // shared session would trip reuse detection instead of measuring latency.
  if (!sessions[__VU]) {
    sessions[__VU] = signup('customer', 0);
    if (!sessions[__VU]) return;
  }
  const session = sessions[__VU];

  const res = http.post(
    `${API}/auth/refresh`,
    JSON.stringify({ refreshToken: session.refreshToken }),
    { ...jsonHeaders(), tags: { operation: 'refresh' } },
  );

  const ok = check(res, { 'refresh 200': (r) => r.status === 200 });
  if (ok) {
    session.token = res.json('accessToken');
    session.refreshToken = res.json('refreshToken');
  } else {
    // Family was revoked; start a clean session rather than hammering.
    sessions[__VU] = signup('customer', 1);
  }

  sleep(Math.random() * 5 + 2);
}
