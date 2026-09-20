import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import type { NotificationList, NotificationRow } from '../../types/api';

export function useNotifications(unreadOnly = false) {
  return usePagedQuery<NotificationRow>({
    queryKey: [...qk.notifications.list, unreadOnly],
    fetchPage: (cursor, signal) =>
      api.get('/notifications', { limit: 20, cursor, unreadOnly: unreadOnly || undefined }, signal),
  });
}

/**
 * Just the badge count.
 *
 * A one-row fetch rather than the full list: the tab bar needs a number, and
 * pulling twenty notifications to count them is work nobody sees.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...qk.notifications.all, 'unread'],
    queryFn: ({ signal }) =>
      api.get<NotificationList>('/notifications', { limit: 1 }, signal),
    select: (res) => res.unreadCount,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

/**
 * Where a notification should take you.
 *
 * The server puts entity ids in `data`; this turns them into a route. An
 * unrecognised type lands on the notifications list rather than nowhere,
 * which is what happens when a newer server sends a type this build predates.
 */
export function notificationRoute(
  notification: NotificationRow,
): { pathname: string; params?: Record<string, string> } | null {
  const data = notification.data ?? {};
  const id = (key: string): string | null => {
    const value = data[key];
    return typeof value === 'string' ? value : null;
  };

  const quoteId = id('quoteId');
  if (quoteId) return { pathname: '/quote/[id]', params: { id: quoteId } };

  const invoiceId = id('invoiceId');
  if (invoiceId) return { pathname: '/invoice/[id]', params: { id: invoiceId } };

  const jobId = id('jobId');
  if (jobId) return { pathname: '/job/[id]', params: { id: jobId } };

  return null;
}
