import { Redirect, Stack } from 'expo-router';

import { FullScreenLoader, HOME_FOR_ROLE } from '../../src/components/Guard';
import { useAuth } from '../../src/state/auth';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function AuthLayout() {
  const { status, user } = useAuth();
  const theme = useTheme();

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
        contentStyle: { backgroundColor: theme.colors.canvas },
        animation: 'slide_from_right',
      }}
    />
  );
}
