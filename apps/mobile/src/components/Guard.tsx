import { Redirect } from 'expo-router';

import { useAuth } from '../state/auth';
import { LaunchScreen } from './LaunchScreen';
import type { Role } from '../types/api';

/** Where each role lands after signing in. */
export const HOME_FOR_ROLE: Record<Role, string> = {
  customer: '/(customer)',
  provider: '/(provider)',
  admin: '/(admin)',
};

/**
 * What is shown while the session is being restored.
 *
 * The branded launch screen rather than a bare spinner: this is the same
 * moment the OS splash was covering, so continuing the artwork reads as the
 * app still starting rather than as a new, emptier screen.
 */
export function FullScreenLoader() {
  return <LaunchScreen />;
}

/**
 * Keeps a section to the role it belongs to.
 *
 * This is convenience, not security. Every one of these screens calls an
 * endpoint that checks the same thing server-side, and a customer who reached
 * a provider route by URL would get 403s rather than data. Redirecting is so
 * that nobody has to discover that the hard way.
 */
export function RequireRole({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous' || !user) return <Redirect href="/(auth)/sign-in" />;
  if (user.role !== role) return <Redirect href={HOME_FOR_ROLE[user.role] as never} />;

  return <>{children}</>;
}

/** Any signed-in role. Used by the screens all three share. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Redirect href="/(auth)/sign-in" />;

  return <>{children}</>;
}
