/**
 * The HTTP client.
 *
 * Deliberately free of any Expo or React Native import so it can be unit
 * tested under plain Node — the refresh-serialisation rule below is the kind
 * of thing that has to be provable, not assumed. `src/services/api.ts` wires
 * it to the real keychain and the real base URL.
 */

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: ApiErrorDetail[] | Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorShape['details'];
  readonly requestId?: string;
  /** Seconds to wait, from `Retry-After` on a 429. */
  readonly retryAfter?: number;

  constructor(
    status: number,
    body: { error?: ApiErrorShape; requestId?: string },
    retryAfter?: number,
  ) {
    super(body.error?.message ?? defaultMessageFor(status));
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'unknown';
    this.details = body.error?.details;
    this.requestId = body.requestId;
    this.retryAfter = retryAfter;
  }

  /** Field-level messages keyed by field, ready for `setError` on a form. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details
        .filter((d): d is ApiErrorDetail => typeof d?.field === 'string')
        .map((d) => [d.field, d.message]),
    );
  }

  /** True when retrying the same request might plausibly work. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

function defaultMessageFor(status: number): string {
  if (status === 0) return 'We could not reach Ruvik. Check your connection and try again.';
  if (status === 404) return 'We could not find that.';
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return 'Something went wrong. Please try again.';
}

/** Where the refresh token lives. In the app, the OS keychain. */
export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Sent as `Idempotency-Key`. Required by every money-moving endpoint. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Skips the bearer header entirely — used by public discovery calls. */
  anonymous?: boolean;
  /** Internal: stops the 401 retry from looping. */
  retried?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetchImpl?: typeof fetch;
  /** Called once when the session is gone for good and the user must sign in. */
  onSessionLost?: () => void;
}

const API_PREFIX = '/api/v1';

export class ApiClient {
  private accessToken: string | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Resolves a possibly-relative API URL (a PDF link, say) to an absolute one. */
  absoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.options.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  /**
   * The stored refresh token, so sign-out can present it and have the server
   * revoke the family. Dropping it locally alone would leave a live 30-day
   * credential in the database.
   */
  peekRefreshToken(): Promise<string | null> {
    return this.options.store.getRefreshToken();
  }

  async adoptSession(tokens: SessionTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    await this.options.store.setRefreshToken(tokens.refreshToken);
  }

  async clearSession(): Promise<void> {
    this.accessToken = null;
    await this.options.store.setRefreshToken(null);
  }

  /**
   * Rotates the refresh token and adopts the new access token.
   *
   * Every caller goes through this one promise. Refresh tokens are single-use
   * and the server treats a second presentation of the same token as theft —
   * it revokes the whole family. Two screens refreshing at once would
   * therefore sign the user out, so concurrent callers share one rotation.
   */
  async refresh(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const refreshToken = await this.options.store.getRefreshToken();
        if (!refreshToken) return null;

        const res = await this.fetchImpl(`${this.options.baseUrl}${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;

        const data = (await res.json()) as Partial<SessionTokens>;
        if (!data.accessToken || !data.refreshToken) return null;

        this.accessToken = data.accessToken;
        await this.options.store.setRefreshToken(data.refreshToken);
        return data.accessToken;
      } catch {
        // A network failure is not a dead session. Returning null lets the
        // caller surface an error without wiping the keychain.
        return null;
      } finally {
        // Released only once settled, so everyone who arrived mid-flight
        // shares this single rotation rather than starting another.
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, idempotencyKey, signal, anonymous } = options;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!anonymous && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let res: Response;
    try {
      res = await this.fetchImpl(buildUrl(this.options.baseUrl, path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // An aborted request is the caller leaving the screen, not a failure to
      // report. Re-throwing it lets React Query discard it quietly.
      if (isAbort(err)) throw err;
      throw new ApiError(0, {});
    }

    if (res.status === 401 && !anonymous && !options.retried) {
      const token = await this.refresh();
      if (token) return this.request<T>(path, { ...options, retried: true });
      await this.clearSession();
      this.options.onSessionLost?.();
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        // A non-JSON body from a proxy or a crash: keep the status, drop the
        // noise, and never let a parse error masquerade as a success.
        if (res.ok) throw new ApiError(502, {});
      }
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      throw new ApiError(
        res.status,
        payload as { error?: ApiErrorShape; requestId?: string },
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return payload as T;
  }

  get<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) {
    return this.request<T>(path, { query, signal });
  }

  /** Public discovery: works signed out, and must not send a stale bearer. */
  getPublic<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) {
    return this.request<T>(path, { query, signal, anonymous: true });
  }

  post<T>(path: string, body?: unknown, idempotencyKey?: string) {
    return this.request<T>(path, { method: 'POST', body, idempotencyKey });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  del<T>(path: string, query?: Record<string, QueryValue>) {
    return this.request<T>(path, { method: 'DELETE', query });
  }
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  );
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const url = `${baseUrl}${API_PREFIX}${path}`;
  if (!query) return url;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `${url}?${parts.join('&')}` : url;
}
