import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, newIdempotencyKey } from '../../services/api';
import { qk } from '../../services/queryKeys';
import type { CheckoutIntent, Plan, Subscription } from '../../types/api';

export function usePlans() {
  return useQuery({
    queryKey: qk.billing.plans,
    queryFn: ({ signal }) => api.getPublic<{ data: Plan[] }>('/billing/plans', undefined, signal),
    staleTime: 10 * 60_000,
    select: (res) => res.data,
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: qk.billing.subscription,
    queryFn: ({ signal }) =>
      api.get<{ subscription: Subscription | null }>('/billing/subscription', undefined, signal),
    select: (res) => res.subscription,
  });
}

/**
 * Starts a subscription.
 *
 * A free plan comes back active; a priced one comes back `pending_payment`
 * with a checkout intent. Activation is the payment provider's signed webhook,
 * never this client saying the payment went through — a forged success
 * callback must not be able to grant a paid plan.
 */
export function useStartSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planCode: string) =>
      api.post<CheckoutIntent>('/billing/subscription', { planCode }, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.billing.subscription });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    // Explicitly typed rather than defaulted: a default parameter makes the
    // mutation's variable type `void`, and the call site then cannot pass one.
    mutationFn: (immediate: boolean) =>
      api.del<{ status: string }>('/billing/subscription', { immediate: immediate || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.billing.subscription });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}
