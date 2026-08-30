import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError } from './api';

const FALLBACK_ERROR = 'We could not load this. Please try again.';

const messageFor = (err: unknown) => (err instanceof ApiError ? err.message : FALLBACK_ERROR);

export interface AsyncState<T> {
  data: T | null;
  /** No data to show yet — render a skeleton. */
  loading: boolean;
  /** Fetching over data already on screen — keep it, just mark it stale. */
  refreshing: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetches on mount and whenever a dependency changes. Results from a stale
 * request are discarded, so fast typing in a search box cannot leave an
 * out-of-order response on screen.
 *
 * `loading` and `refreshing` are split so a refetch does not blank out a list
 * the user is already reading; only the very first load has nothing to show.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [settled, setSettled] = useState(false);
  const [inFlight, setInFlight] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const id = ++requestId.current;
    setInFlight(true);
    setError(null);

    fetcherRef.current()
      .then((result) => {
        if (id !== requestId.current) return;
        setData(result);
        setSettled(true);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(messageFor(err));
        setSettled(true);
      })
      .finally(() => {
        if (id === requestId.current) setInFlight(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data,
    loading: inFlight && !settled,
    refreshing: inFlight && settled,
    error,
    reload,
  };
}

/* ---------------------------------------------------------- pagination --- */

export interface PagedResponse<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export interface PagedState<T, R = PagedResponse<T>> {
  items: T[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  /** A failed "load more" must not wipe the pages already on screen. */
  moreError: string | null;
  /**
   * The most recent page envelope, for endpoints that carry more than the
   * list itself — /notifications returns an unreadCount alongside its rows.
   */
  response: R | null;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Cursor-paginated list. Changing a dependency starts a fresh first page;
 * loadMore appends. Both paths share a request id, so a filter change while a
 * page is in flight discards that page instead of appending it to a list it
 * no longer belongs to.
 */
export function usePagedApi<T, R extends PagedResponse<T> = PagedResponse<T>>(
  fetchPage: (cursor: string | null) => Promise<R>,
  deps: unknown[] = [],
): PagedState<T, R> {
  const [items, setItems] = useState<T[]>([]);
  const [response, setResponse] = useState<R | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [settled, setSettled] = useState(false);
  const [inFlight, setInFlight] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    const id = ++requestId.current;
    setInFlight(true);
    setLoadingMore(false);
    setError(null);
    setMoreError(null);

    fetchRef.current(null)
      .then((page) => {
        if (id !== requestId.current) return;
        setItems(page.data);
        setResponse(page);
        setCursor(page.pagination.nextCursor);
        setHasMore(page.pagination.hasMore);
        setSettled(true);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(messageFor(err));
        setSettled(true);
      })
      .finally(() => {
        if (id === requestId.current) setInFlight(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  // Guarded by a ref rather than the loadingMore state: two calls in the same
  // tick would both read the pre-update cursor and append the same page twice.
  const morePending = useRef(false);

  const loadMore = useCallback(() => {
    if (!cursor || morePending.current) return;
    const id = requestId.current;
    morePending.current = true;
    setLoadingMore(true);
    setMoreError(null);

    fetchRef.current(cursor)
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((current) => [...current, ...page.data]);
        setResponse(page);
        setCursor(page.pagination.nextCursor);
        setHasMore(page.pagination.hasMore);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setMoreError(messageFor(err));
      })
      .finally(() => {
        morePending.current = false;
        if (id === requestId.current) setLoadingMore(false);
      });
  }, [cursor]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    items,
    loading: inFlight && !settled,
    refreshing: inFlight && settled,
    error,
    hasMore,
    loadingMore,
    moreError,
    response,
    loadMore,
    reload,
  };
}

/** Debounces a rapidly changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
