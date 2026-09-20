import { Redirect, Stack } from 'expo-router';

import { FullScreenLoader, HOME_FOR_ROLE } from '../../src/components/Guard';
import { useAuth } from '../../src/state/auth';
import { brand } from '../../src/theme/tokens';

export default function AuthLayout() {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  // Someone already signed in has no business on the sign-in screen; the back
  // gesture from a tab would otherwise land here.
  if (status === 'authenticated' && user) {
    return <Redirect href={HOME_FOR_ROLE[user.role] as never} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Navy, not the theme canvas: these screens have a navy band at the
        // top, and a light background behind the transition flashes white
        // down the edge as the new screen slides in.
        contentStyle: { backgroundColor: brand.navy },
        animation: 'slide_from_right',
        animationDuration: 260,
      }}
    />
  );
}
