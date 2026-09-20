import { describe, it, expect, vi } from 'vitest';

import { ApiClient, ApiError, buildUrl, type TokenStore } from './apiClient';

function memoryStore(initial: string | null = null): TokenStore & { current: string | null } {
  return {
    current: initial,
    async getRefreshToken() { return this.current; },
    async setRefreshToken(token: string | null) { this.current = token; },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const BASE = 'http://api.test';

describe('buildUrl', () => {
  it('drops empty values instead of sending them as blanks', () => {
    const url = buildUrl(BASE, '/search/services', {
      q: 'drywall', city: '', limit: 20, verifiedOnly: undefined, cursor: null,
    });
    expect(url).toBe(`${BASE}/api/v1/search/services?q=drywall&limit=20`);
  });

  it('escapes what the user typed', () => {
    const url = buildUrl(BASE, '/search/services', { q: 'a&b=c d' });
    expect(url).toBe(`${BASE}/api/v1/search/services?q=a%26b%3Dc%20d`);
  });
});

describe('ApiError', () => {
  it('exposes field errors keyed for a form', () => {
    const error = new ApiError(422, {
      error: {
        code: 'validation_failed',
        message: 'Some fields need your attention.',
        details: [{ field: 'priceCents', message: 'Set a price for this pricing type.' }],
      },
    });
    expect(error.fieldErrors()).toEqual({ priceCents: 'Set a price for this pricing type.' });
  });

  it('treats 4xx as final and transport or 5xx as worth retrying', () => {
    expect(new ApiError(403, {}).isTransient).toBe(false);
    expect(new ApiError(404, {}).isTransient).toBe(false);
    expect(new ApiError(429, {}).isTransient).toBe(true);
    expect(new ApiError(503, {}).isTransient).toBe(true);
    expect(new ApiError(0, {}).isTransient).toBe(true);
  });
});

describe('ApiClient: requests', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });
    await client.adoptSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const body = await client.get<{ ok: boolean }>('/auth/me');

    expect(body).toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('omits the bearer on a public call, so a stale token cannot leak into search', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(200, { data: [] }));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });
    await client.adoptSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await client.getPublic('/search/services');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('passes the idempotency key straight through', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(201, { id: 'x' }));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });

    await client.post('/invoices/1/payments', { amountCents: 100 }, 'key-abc');

    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBe('key-abc');
  });

  it('turns a transport failure into a 0 rather than an unhandled throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Network request failed'); });
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });

    await expect(client.get('/auth/me')).rejects.toMatchObject({ status: 0, code: 'unknown' });
  });

  it('surfaces the server message and request id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {
      error: { code: 'conflict', message: 'An invoice already exists for this quote.' },
      requestId: 'req-42',
    }));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });

    await expect(client.post('/invoices', {})).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'An invoice already exists for this quote.',
      requestId: 'req-42',
    });
  });

  it('reads Retry-After off a rate limit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'Retry-After': '30' },
    ));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });

    await expect(client.get('/search/services')).rejects.toMatchObject({ retryAfter: 30 });
  });
});

describe('ApiClient: session refresh', () => {
  it('refreshes once on a 401 and replays the request', async () => {
    const store = memoryStore('refresh-1');
    const calls: string[] = [];

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === 'Bearer access-2') return jsonResponse(200, { ok: true });
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Expired.' } });
    });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });
    await client.adoptSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(client.get('/auth/me')).resolves.toEqual({ ok: true });

    // Rotation is persisted, so the next cold start presents the new token.
    expect(store.current).toBe('refresh-2');
    expect(calls.filter((c) => c.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('serialises concurrent refreshes into one rotation', async () => {
    // The rule this protects: refresh tokens are single-use, and the server
    // reads a second presentation of the same token as theft — it revokes the
    // whole family. Two screens refreshing at once must not sign the user out.
    const store = memoryStore('refresh-1');
    let refreshCalls = 0;

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      return jsonResponse(200, {});
    });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });

    const results = await Promise.all([client.refresh(), client.refresh(), client.refresh()]);

    expect(refreshCalls).toBe(1);
    expect(results).toEqual(['access-2', 'access-2', 'access-2']);
  });

  it('starts a fresh rotation once the previous one has settled', async () => {
    const store = memoryStore('refresh-1');
    let refreshCalls = 0;

    const fetchImpl = vi.fn(async () => {
      refreshCalls += 1;
      return jsonResponse(200, {
        accessToken: `access-${refreshCalls}`, refreshToken: `refresh-${refreshCalls}`,
      });
    });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });

    await client.refresh();
    await client.refresh();

    expect(refreshCalls).toBe(2);
  });

  it('clears the session and reports it when the refresh token is rejected', async () => {
    const store = memoryStore('refresh-dead');
    const onSessionLost = vi.fn();

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'No session.' } });
      }
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Expired.' } });
    });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl, onSessionLost });
    await client.adoptSession({ accessToken: 'access-1', refreshToken: 'refresh-dead' });

    await expect(client.get('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(store.current).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('does not wipe the keychain when the refresh merely could not reach the network', async () => {
    // A dead network is not a dead session. Clearing here would sign people
    // out every time they walked into a lift.
    const store = memoryStore('refresh-1');
    const fetchImpl = vi.fn(async () => { throw new TypeError('Network request failed'); });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.refresh()).resolves.toBeNull();
    expect(store.current).toBe('refresh-1');
  });

  it('does not loop when the replayed request is also rejected', async () => {
    const store = memoryStore('refresh-1');
    let protectedCalls = 0;

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      protectedCalls += 1;
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Still no.' } });
    });

    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });
    await client.adoptSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(client.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(protectedCalls).toBe(2);
  });

  it('never refreshes a public call, even on a 401', async () => {
    const store = memoryStore('refresh-1');
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}));
    const client = new ApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.getPublic('/categories')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('ApiClient: URLs and logout', () => {
  it('leaves an absolute document URL alone and prefixes a relative one', () => {
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore() });

    expect(client.absoluteUrl('https://cdn.example/x.pdf')).toBe('https://cdn.example/x.pdf');
    expect(client.absoluteUrl('/api/v1/files/download?key=a')).toBe(`${BASE}/api/v1/files/download?key=a`);
    expect(client.absoluteUrl('files/x.pdf')).toBe(`${BASE}/files/x.pdf`);
  });

  it('hands back the stored refresh token so sign-out can revoke the family', async () => {
    const store = memoryStore();
    const client = new ApiClient({ baseUrl: BASE, store });
    await client.adoptSession({ accessToken: 'a', refreshToken: 'r' });

    await expect(client.peekRefreshToken()).resolves.toBe('r');

    await client.clearSession();
    await expect(client.peekRefreshToken()).resolves.toBeNull();
  });

  it('returns undefined for a 204 rather than trying to parse it', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: BASE, store: memoryStore(), fetchImpl });

    await expect(client.del('/account/whatsapp-consent')).resolves.toBeUndefined();
  });
});
