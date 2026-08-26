import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, SEARCH_TERMS, pick, jsonHeaders } from './common.js';

/**
 * Resilience profiles. Select one with:
 *   k6 run -e PROFILE=spike loadtest/k6/stress-spike-soak.js
 *
 *   stress — ramp past the expected peak until the platform degrades, to
 *            establish the breaking point and confirm it degrades
 *            gracefully (429/503) rather than failing hard.
 *   spike  — a sudden 20x surge, modelling a marketing push or a storm
 *            driving emergency plumbing demand.
 *   soak   — sustained moderate load for an hour to surface memory leaks,
 *            connection-pool exhaustion and queue backlog growth.
 */
const PROFILES = {
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 20, timeUnit: '1s', preAllocatedVUs: 100, maxVUs: 1000,
    stages: [
      { target: 100, duration: '2m' },
      { target: 300, duration: '2m' },
      { target: 600, duration: '2m' },
      { target: 1000, duration: '2m' },
      { target: 0, duration: '1m' },
    ],
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 20, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 1500,
    stages: [
      { target: 20, duration: '1m' },
      { target: 400, duration: '15s' },
      { target: 400, duration: '1m' },
      { target: 20, duration: '15s' },
      { target: 20, duration: '2m' },
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 60, timeUnit: '1s', duration: '1h',
    preAllocatedVUs: 100, maxVUs: 300,
  },
};

const profile = __ENV.PROFILE || 'stress';

export const options = {
  scenarios: { [profile]: PROFILES[profile] },
  thresholds: {
    // Under stress the platform may shed load; what must not happen is a
    // 5xx. Rate limiting (429) and backpressure (503) are correct answers.
    'http_req_failed{expected_response:true}': ['rate<0.05'],
    'checks': ['rate>0.90'],
  },
};

export default function () {
  const res = http.get(
    `${API}/search/services?limit=20&q=${encodeURIComponent(pick(SEARCH_TERMS))}`,
    { ...jsonHeaders(), tags: { operation: 'search' } },
  );

  check(res, {
    'no server error': (r) => r.status < 500,
    'degrades politely': (r) => [200, 429, 503].includes(r.status),
  });

  sleep(0.5);
}
