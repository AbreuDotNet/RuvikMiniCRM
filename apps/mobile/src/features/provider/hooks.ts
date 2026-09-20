import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';
import type {
  BusinessProfile, ProviderDashboard, ProviderService, TaxSettings,
} from '../../types/api';

export function useProviderDashboard() {
  return useQuery({
    queryKey: qk.provider.dashboard,
    queryFn: ({ signal }) => api.get<ProviderDashboard>('/provider/dashboard', undefined, signal),
    staleTime: 30_000,
  });
}

export function useBusinessProfile() {
  return useQuery({
    queryKey: qk.provider.profile,
    queryFn: ({ signal }) => api.get<BusinessProfile>('/provider/profile', undefined, signal),
  });
}

export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * Only the fields the form owns are sent. `verificationStatus`,
     * `ratingAvg` and `slug` are absent by design — the server drops them
     * anyway, and including them would suggest they are ours to set.
     */
    mutationFn: (input: Partial<BusinessProfile>) =>
      api.patch<BusinessProfile>('/provider/profile', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.provider.profile });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export function useProviderServices() {
  return useQuery({
    queryKey: qk.provider.services,
    queryFn: ({ signal }) =>
      api.get<{ data: ProviderService[] }>('/provider/services', { limit: 50 }, signal),
    select: (res) => res.data,
  });
}

export interface ServiceInput {
  categoryId: string;
  title: string;
  shortDescription?: string | null;
  description?: string | null;
  pricingType: 'fixed' | 'starting_at' | 'request_quote';
  priceCents?: number | null;
  currency?: string;
  estimatedDurationMin?: number | null;
  coverageArea?: string | null;
  status?: 'draft' | 'active' | 'paused';
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    // The plan's listing cap is enforced server-side. A 409 here is the plan
    // limit talking, and the message it carries is the one to show.
    mutationFn: (input: ServiceInput) => api.post<ProviderService>('/provider/services', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.provider.services });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ServiceInput> }) =>
      api.patch<ProviderService>(`/provider/services/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.provider.services });
    },
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/provider/services/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.provider.services });
    },
  });
}

export function useTaxSettings() {
  return useQuery({
    queryKey: qk.provider.taxSettings,
    queryFn: ({ signal }) => api.get<TaxSettings>('/provider/tax-settings', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateTaxSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<TaxSettings>) => api.patch<TaxSettings>('/provider/tax-settings', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.provider.taxSettings });
    },
  });
}
