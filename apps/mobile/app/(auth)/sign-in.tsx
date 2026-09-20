import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { ApiError } from '../../src/services/apiClient';
import { errorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';

/**
 * Client-side validation here is about typos, not security. It catches an
 * empty field before a round trip; every real rule (password strength, rate
 * limits, whether the account exists) is the server's.
 */
const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').email('That does not look like an email.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

export default function SignIn() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { notify } = useFeedback();
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await login(values.email.trim(), values.password);
      if (result.mfaRequired && result.mfaToken) {
        router.push({ pathname: '/(auth)/mfa', params: { mfaToken: result.mfaToken } });
      }
      // On success the auth state flips and the layout redirects; there is
      // nothing to navigate to from here.
    } catch (err) {
      if (err instanceof ApiError) {
        // Field-level messages where the server gave them, a banner otherwise.
        const fields = err.fieldErrors();
        for (const [field, message] of Object.entries(fields)) {
          if (field === 'email' || field === 'password') {
            setError(field, { message });
          }
        }
        if (!Object.keys(fields).length) {
          // 401 here means "wrong email or password" and says nothing about
          // which — repeating the server's wording keeps it that way.
          notify(err.message, 'error');
        }
      } else {
        notify(errorMessage(err), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <ScreenScroll keyboardAware contentStyle={{ paddingTop: insets.top + spacing.xxl }}>
      <Stack gap={spacing.xs}>
        <View
          style={{
            width: 44, height: 44, borderRadius: 14,
            backgroundColor: theme.colors.primary,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: spacing.md,
          }}
        >
          <Text variant="title" style={{ color: theme.colors.onPrimary }}>R</Text>
        </View>
        <Text variant="display" accessibilityRole="header">Welcome back</Text>
        <Text variant="body" tone="muted">
          Sign in to manage your jobs, quotes and invoices.
        </Text>
      </Stack>

      <Stack gap={spacing.md}>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              leftIcon="mail-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              returnKeyType="next"
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <Input
              label="Password"
              placeholder="Your password"
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              leftIcon="lock-closed-outline"
              secure
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
            />
          )}
        />

        <Button
          label="Sign in"
          loading={submitting || formState.isSubmitting}
          onPress={() => void onSubmit()}
        />

        <Button
          label="Forgot your password?"
          variant="ghost"
          onPress={() => router.push('/(auth)/forgot-password')}
        />
      </Stack>

      <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }}>
        <Text variant="caption" tone="muted">New to Ruvik?</Text>
        <Button
          label="Create an account"
          variant="secondary"
          fullWidth={false}
          onPress={() => router.push('/(auth)/sign-up')}
        />
      </View>
    </ScreenScroll>
  );
}
