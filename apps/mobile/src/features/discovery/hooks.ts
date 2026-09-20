import { useQuery } from '@tanstack/react-query';

import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import type {
  Category, FeaturedProvider, PublicProvider, ServiceCard, ServiceDetail,
} from '../../types/api';

export interface ServiceSearchFilters {
  q?: string;
  category?: string;
  city?: string;
  pricingType?: string;
  minRating?: number;
  maxPriceCents?: number;
  verifiedOnly?: boolean;
  sort?: string;
}

/** Categories move rarely; the server already caches them for two minutes. */
export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    queryFn: ({ signal }) => api.getPublic<{ data: Category[] }>('/categories', undefined, signal),
    staleTime: 10 * 60_000,
    select: (res) => res.data,
  });
}

export function useFeaturedProviders(limit = 6) {
  return useQuery({
    queryKey: [...qk.featuredProviders, limit],
    queryFn: ({ signal }) =>
      api.getPublic<{ data: FeaturedProvider[] }>('/providers/featured', { limit }, signal),
    staleTime: 5 * 60_000,
    select: (res) => res.data,
  });
}

export function useServiceSearch(filters: ServiceSearchFilters) {
  return usePagedQuery<ServiceCard>({
    queryKey: qk.searchServices(filters as Record<string, string | number | boolean | undefined>),
    staleTime: 60_000,
    fetchPage: (cursor, signal) =>
      api.getPublic('/search/services', { ...filters, limit: 20, cursor }, signal),
  });
}

export function useProviderProfile(slug: string) {
  return useQuery({
    queryKey: qk.providerProfile(slug),
    enabled: Boolean(slug),
    queryFn: ({ signal }) => api.getPublic<PublicProvider>(`/providers/${slug}`, undefined, signal),
  });
}

export function useServiceDetail(id: string) {
  return useQuery({
    queryKey: qk.service(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.getPublic<ServiceDetail>(`/services/${id}`, undefined, signal),
  });
}
