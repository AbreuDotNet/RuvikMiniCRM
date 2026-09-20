import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, newIdempotencyKey } from '../../services/api';
import { qk } from '../../services/queryKeys';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import type { CustomerHome, CustomerRequestDetail, CustomerRequestRow } from '../../types/api';

export function useCustomerHome() {
  return useQuery({
    queryKey: qk.customer.home,
    queryFn: ({ signal }) => api.get<CustomerHome>('/customer/home', undefined, signal),
    staleTime: 30_000,
  });
}

export function useCustomerRequests() {
  return usePagedQuery<CustomerRequestRow>({
    queryKey: qk.customer.requests,
    fetchPage: (cursor, signal) => api.get('/customer/requests', { limit: 20, cursor }, signal),
  });
}

export function useCustomerRequest(id: string) {
  return useQuery({
    queryKey: qk.customer.request(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api.get<CustomerRequestDetail>(`/customer/requests/${id}`, undefined, signal),
  });
}

export interface NewRequestInput {
  providerId: string;
  serviceId?: string | null;
  title: string;
  description: string;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  phone?: string;
  preferredDate?: string | null;
}

export function useCreateRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * The key is minted once per attempt, so a retry after a dropped response
     * replays the original rather than opening a second request with the same
     * provider.
     */
    mutationFn: (input: NewRequestInput) =>
      api.post<{ id: string; reference: string; providerName: string }>(
        '/customer/requests', input, newIdempotencyKey(),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.customer.requests });
      void queryClient.invalidateQueries({ queryKey: qk.customer.home });
    },
  });
}

export function useSubmitReview(requestId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { rating: number; comment?: string }) =>
      api.post(`/customer/requests/${requestId}/review`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.customer.request(requestId) });
      void queryClient.invalidateQueries({ queryKey: qk.customer.requests });
    },
  });
}
