import { Redirect } from 'expo-router';

import { FullScreenLoader, HOME_FOR_ROLE } from '../src/components/Guard';
import { useAuth } from '../src/state/auth';

/**
 * The entry point: decide where this person belongs and go there.
 *
 * Nothing renders here. While the keychain's refresh token is being exchanged
 * the loader holds, because redirecting to sign-in first and bouncing back a
 * moment later is the flicker every app with a silent session restore has.
 */
export default function Index() {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous' || !user) return <Redirect href="/(auth)/sign-in" />;

  return <Redirect href={HOME_FOR_ROLE[user.role] as never} />;
}
