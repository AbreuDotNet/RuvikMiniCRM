import { useEffect } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { registerDeviceToken, registerForPush } from '../services/push';
import { useAuth } from '../state/auth';

/**
 * Asks for push permission once a session exists, and routes a tapped
 * notification to the thing it is about.
 *
 * Permission is requested after sign-in rather than on first launch: a prompt
 * that arrives before someone knows what the app is gets denied, and on iOS
 * that denial is close to permanent.
 *
 * The token is obtained but not yet sent anywhere — see `services/push.ts`.
 */
export function usePushRegistration(): void {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    void (async () => {
      const registration = await registerForPush();
      if (cancelled || !registration.token) return;
      await registerDeviceToken(registration.token);
    })();

    return () => { cancelled = true; };
  }, [status]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const target = routeFor(data);
      if (target) router.push(target as never);
    });
    return () => subscription.remove();
  }, []);
}

function routeFor(data: Record<string, unknown>): string | null {
  const id = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : null);

  const invoiceId = id('invoiceId');
  if (invoiceId) return `/invoice/${invoiceId}`;

  const quoteId = id('quoteId');
  if (quoteId) return `/quote/${quoteId}`;

  const jobId = id('jobId');
  if (jobId) return `/job/${jobId}`;

  // An unrecognised payload still opens something useful rather than nothing.
  return '/notifications';
}
