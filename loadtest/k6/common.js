import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://localhost:4000';
export const API = `${BASE}/api/v1`;

/** Latency budgets from docs/slo.md, expressed as k6 thresholds. */
export const SLO_THRESHOLDS = {
  'http_req_failed': ['rate<0.01'],
  'http_req_duration{operation:search}': ['p(95)<300'],
  'http_req_duration{operation:profile}': ['p(95)<300'],
  'http_req_duration{operation:dashboard}': ['p(95)<400'],
  'http_req_duration{operation:quote_create}': ['p(95)<500'],
  'http_req_duration{operation:invoice_create}': ['p(95)<500'],
  'http_req_duration{operation:refresh}': ['p(95)<250'],
  // Argon2id is intentionally expensive; the budget reflects that.
  'http_req_duration{operation:login}': ['p(95)<1200'],
};

export const SEARCH_TERMS = [
  'plumber', 'air conditioner repair', 'electrician', 'carpenter',
  'painting', 'leak', 'water heater', 'panel upgrade', '',
];

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function jsonHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

/** Signs up a fresh account. Each VU owns its own session. */
export function signup(role, index) {
  const email = `k6-${role}-${__VU}-${index}-${Date.now()}@loadtest.local`;
  const payload = {
    email,
    password: 'LoadTest-Passphrase-9',
    fullName: `K6 ${role}`,
    role,
    city: 'Santo Domingo',
    ...(role === 'provider' ? { businessName: `K6 Co ${__VU}-${index}` } : {}),
  };

  const res = http.post(`${API}/auth/signup`, JSON.stringify(payload), {
    ...jsonHeaders(),
    tags: { operation: 'login' },
  });
  check(res, { 'signup 201': (r) => r.status === 201 });
  if (res.status !== 201) return null;

  const body = res.json();
  return { token: body.accessToken, refreshToken: body.refreshToken, user: body.user };
}
