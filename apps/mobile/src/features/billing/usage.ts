import { useQuery } from '@tanstack/react-query';

import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

/**
 * The plan's allowances and how much of each is gone.
 *
 * Read from `/provider/entitlements`, which is served by the same module that
 * enforces the limits — so what this screen shows and what the server refuses
 * on cannot drift apart.
 */

export type Capability =
  | 'fiscal_reports'
  | 'tax_estimates'
  | 'priority_support'
  | 'team_members'
  | 'payment_gateway'
  | 'advanced_backup';

export interface UsageCheck {
  used: number;
  /** Null is unlimited. */
  limit: number | null;
  exhausted: boolean;
}

export interface Entitlements {
  plan: { id: string; code: string; name: string };
  subscriptionStatus: string | null;
  /** False when the limits come from the fallback rather than a subscription. */
  fromLiveSubscription: boolean;
  limits: {
    maxClients: number | null;
    maxReceiptsPerMonth: number | null;
    maxServices: number | null;
    maxQuotesPerMonth: number | null;
    maxTeamMembers: number;
  };
  capabilities: Capability[];
  /** Granted by the plan, not yet built. The server is explicit about this. */
  unimplemented: Capability[];
  usage: {
    clients: UsageCheck;
    receiptsThisMonth: UsageCheck;
    services: UsageCheck;
    quotesThisMonth: UsageCheck;
  };
}

export const CAPABILITY_LABELS: Record<Capability, string> = {
  fiscal_reports: 'Export tax reports',
  tax_estimates: 'Estimated quarterly taxes',
  priority_support: 'Priority support',
  team_members: 'Assistants and employees',
  payment_gateway: 'Payments recorded automatically',
  advanced_backup: 'Advanced cloud backup',
};

export function useEntitlements() {
  return useQuery({
    queryKey: qk.provider.entitlements,
    queryFn: ({ signal }) => api.get<Entitlements>('/provider/entitlements', undefined, signal),
    // Short, because a limit that has just been hit should stop showing room
    // the server will not honour.
    staleTime: 15_000,
  });
}

/** "7 of 10" — or just the count when the plan has no ceiling. */
export function usageLabel(check: UsageCheck): string {
  return check.limit === null ? `${check.used}` : `${check.used} of ${check.limit}`;
}

/** How full an allowance is, 0–1. Unlimited never fills. */
export function usageFraction(check: UsageCheck): number {
  if (check.limit === null || check.limit === 0) return 0;
  return Math.min(1, check.used / check.limit);
}
