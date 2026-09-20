import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from '../src/state/auth';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { FeedbackProvider } from '../src/components/ui';
import { usePushRegistration } from '../src/hooks/usePushRegistration';
import { ApiError } from '../src/services/apiClient';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * One client for the whole app.
 *
 * Retries are deliberate rather than default: a 4xx is the server telling us
 * the request was wrong, and asking again three times only delays the error
 * the person needs to see. Transport failures and 5xx do get another go.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !error.isTransient) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Never automatic. A retried POST without the same idempotency key is
      // how one payment becomes two.
      retry: false,
    },
  },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FeedbackProvider>
            <AuthProvider>
              <ThemedRoot />
            </AuthProvider>
          </FeedbackProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const theme = useTheme();
  usePushRegistration();

  useEffect(() => {
    // Held one frame past mount so the first screen is painted before the
    // splash lifts, rather than flashing an empty canvas between the two.
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {});
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.canvas },
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
          headerShadowVisible: false,
          animation: 'slide_from_right',
          // Slightly quicker than the platform default: these are utility
          // pushes inside a working tool, not a first-run experience.
          animationDuration: 260,
        }}
      >
        {/* These five are swapped by a redirect, not pushed by the user, so
            they cross-fade. A horizontal slide would imply a back gesture
            that does not exist — there is nothing behind a role home. */}
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(customer)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(provider)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(admin)" options={{ animation: 'fade' }} />

        <Stack.Screen name="provider/[slug]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="service/[id]" options={{ headerShown: true, title: 'Service' }} />
        <Stack.Screen name="request/new" options={{ headerShown: true, title: 'Request a quote' }} />
        <Stack.Screen name="request/[id]" options={{ headerShown: true, title: 'Request' }} />
        <Stack.Screen name="job/new" options={{ headerShown: true, title: 'New job' }} />
        <Stack.Screen name="job/[id]" options={{ headerShown: true, title: 'Job' }} />
        <Stack.Screen name="client/new" options={{ headerShown: true, title: 'New client' }} />
        <Stack.Screen name="client/[id]" options={{ headerShown: true, title: 'Client' }} />
        <Stack.Screen name="quote/new" options={{ headerShown: true, title: 'New quote' }} />
        <Stack.Screen name="quote/[id]" options={{ headerShown: true, title: 'Quote' }} />
        <Stack.Screen name="invoice/new" options={{ headerShown: true, title: 'New invoice' }} />
        <Stack.Screen name="invoice/[id]" options={{ headerShown: true, title: 'Invoice' }} />
        <Stack.Screen name="calendar" options={{ headerShown: true, title: 'Calendar' }} />
        <Stack.Screen name="listings" options={{ headerShown: true, title: 'My listings' }} />
        <Stack.Screen name="business-profile" options={{ headerShown: true, title: 'Business profile' }} />
        <Stack.Screen name="verification" options={{ headerShown: true, title: 'Verification' }} />
        <Stack.Screen name="subscription" options={{ headerShown: true, title: 'Subscription' }} />
        <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notifications' }} />
        <Stack.Screen name="settings/profile" options={{ headerShown: true, title: 'Your details' }} />
        <Stack.Screen name="settings/security" options={{ headerShown: true, title: 'Security' }} />
        <Stack.Screen name="settings/appearance" options={{ headerShown: true, title: 'Appearance' }} />
        <Stack.Screen name="settings/messaging" options={{ headerShown: true, title: 'WhatsApp' }} />
        <Stack.Screen name="settings/tax" options={{ headerShown: true, title: 'Tax settings' }} />
      </Stack>
    </>
  );
}
