import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { API, SLO_THRESHOLDS, SEARCH_TERMS, pick, jsonHeaders } from './common.js';

/**
 * Discovery load — the highest-volume path on a marketplace.
 *
 * Sized for a platform with 100,000 customer accounts: assuming 5% are
 * active in a peak hour and each runs ~6 searches, that is roughly
 * 30,000 searches/hour ≈ 8-9 rps sustained, with peaks several times higher.
 * The ramp below drives well past that to find the knee of the curve.
 */
export const options = {
  scenarios: {
    discovery: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: 50, duration: '1m' },
        { target: 150, duration: '2m' },
        { target: 300, duration: '2m' },
        { target: 300, duration: '3m' },
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: SLO_THRESHOLDS,
};

export default function () {
  group('search', () => {
    const term = encodeURIComponent(pick(SEARCH_TERMS));
    const res = http.get(`${API}/search/services?limit=20&q=${term}`, {
      ...jsonHeaders(),
      tags: { operation: 'search' },
    });
    check(res, {
      'search 200': (r) => r.status === 200,
      'search returns a page': (r) => Array.isArray(r.json('data')),
    });

    // Cursor pagination: page two must be as cheap as page one.
    const cursor = res.json('pagination.nextCursor');
    if (cursor) {
      const next = http.get(`${API}/search/services?limit=20&cursor=${encodeURIComponent(cursor)}`, {
        ...jsonHeaders(),
        tags: { operation: 'search' },
      });
      check(next, { 'page 2 200': (r) => r.status === 200 });
    }
  });

  group('profile', () => {
    const featured = http.get(`${API}/providers/featured?limit=10`, {
      ...jsonHeaders(),
      tags: { operation: 'profile' },
    });
    const providers = featured.json('data') || [];
    if (providers.length) {
      const provider = pick(providers);
      const res = http.get(`${API}/providers/${provider.slug}`, {
        ...jsonHeaders(),
        tags: { operation: 'profile' },
      });
      check(res, { 'provider 200': (r) => r.status === 200 });
    }
  });

  sleep(Math.random() * 2);
}
