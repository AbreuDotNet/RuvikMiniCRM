export interface Paginated<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export type QueryValue = string | number | boolean | undefined | null;
