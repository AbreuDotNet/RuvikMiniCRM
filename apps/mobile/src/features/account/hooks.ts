import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';
import type { AccountProfile, WhatsAppConsent } from '../../types/api';

export function useAccountProfile() {
  return useQuery({
    queryKey: qk.account.profile,
    queryFn: ({ signal }) => api.get<AccountProfile>('/account/profile', undefined, signal),
  });
}

export function useUpdateAccountProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fullName?: string; phone?: string | null; locale?: 'en' | 'es';
      city?: string | null; region?: string | null; addressLine?: string | null;
    }) => api.patch<AccountProfile>('/account/profile', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.account.profile });
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useWhatsAppConsent() {
  return useQuery({
    queryKey: qk.account.whatsapp,
    queryFn: ({ signal }) => api.get<WhatsAppConsent>('/account/whatsapp-consent', undefined, signal),
  });
}

export function useOptInWhatsApp() {
  const queryClient = useQueryClient();
  return useMutation({
    // `acknowledged` is not a checkbox we can tick on the user's behalf: the
    // server requires the literal true, and consent that the app supplied is
    // not consent.
    mutationFn: (phone: string) =>
      api.post<WhatsAppConsent>('/account/whatsapp-consent', { phone, acknowledged: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.account.whatsapp });
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useOptOutWhatsApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.del('/account/whatsapp-consent'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.account.whatsapp });
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    // Succeeds and then revokes every other session, so the local one has to
    // survive: the response carries no new tokens and the current access
    // token stays valid until it expires.
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<{ message: string }>('/auth/password/change', input),
  });
}

export function useBeginMfaEnrollment() {
  return useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/enroll', {}),
  });
}

export function useConfirmMfaEnrollment() {
  return useMutation({
    mutationFn: (code: string) =>
      api.post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { code }),
  });
}

export function useDisableMfa() {
  return useMutation({
    mutationFn: (password: string) => api.post<{ message: string }>('/auth/mfa/disable', { password }),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    // Always 202, whether or not the address exists. The response must not
    // tell an attacker which emails have accounts.
    mutationFn: (email: string) => api.post<{ message: string }>('/auth/password/forgot', { email }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (password: string) =>
      api.request<{ message: string }>('/account/delete', {
        method: 'POST',
        body: { password, confirmation: 'DELETE' },
      }),
  });
}
