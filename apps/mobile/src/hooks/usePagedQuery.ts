import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

import type { Paginated, QueryValue } from '../types/paging';

/**
 * Cursor pagination, once.
 *
 * The API pages on `(created_at, id)` and hands back an opaque `nextCursor`.
 * Every list in the app goes through this so none of them reinvents the
 * "hasMore but nextCursor is null" edge, which silently loops forever.
 */
export function usePagedQuery<T>({
  queryKey,
  fetchPage,
  enabled = true,
  staleTime,
}: {
  queryKey: QueryKey;
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<Paginated<T>>;
  enabled?: boolean;
  staleTime?: number;
}) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    staleTime,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last) =>
      // Both conditions, not either: a server that says `hasMore` without a
      // cursor would otherwise re-request page one indefinitely.
      last.pagination.hasMore && last.pagination.nextCursor
        ? last.pagination.nextCursor
        : undefined,
  });

  const items = query.data?.pages.flatMap((page) => page.data) ?? [];

  return {
    ...query,
    items,
    /** Safe to call on every `onEndReached`; it no-ops while already fetching. */
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

export type { QueryValue };
