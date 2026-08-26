/**
 * API client.
 *
 * The access token is held in memory only — never localStorage — so an XSS
 * bug cannot exfiltrate a long-lived credential. The refresh token lives in
 * an httpOnly cookie the JavaScript here cannot read.
 */

const BASE = '/api/v1';

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }> | Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorShape['details'];

  constructor(status: number, body: { error?: ApiErrorShape }) {
    super(body.error?.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'unknown';
    this.details = body.error?.details;
  }

  /** Field-level messages, keyed by field name, for inline form errors. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Rotates the refresh cookie and adopts the new access token.
 *
 * Every caller — session restore on boot and the 401 retry path alike —
 * must go through this one function. Refresh tokens are single-use: if two
 * callers each POST the same cookie, the server sees the second as a replay
 * of an already-rotated token, treats it as theft, and revokes the whole
 * token family. Sharing one in-flight promise is what prevents that.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) return null;
      accessToken = data.accessToken;
      return data.accessToken;
    } catch {
      return null;
    } finally {
      // Released only once the request has settled, so every caller that
      // arrived while it was in flight shares this single rotation.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, idempotencyKey } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && !options._retried && accessToken) {
    if (await refreshSession()) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    accessToken = null;
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    apiRequest<T>(path, { method: 'POST', body, idempotencyKey }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { method: 'DELETE', query }),
};

/** Random key so a retried POST cannot double-charge or duplicate a document. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
