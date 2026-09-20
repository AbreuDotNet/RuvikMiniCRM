import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthScaffold } from '../../src/components/AuthScaffold';
import { Button, Input, Stack, Text, useFeedback } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { applyFieldErrors } from '../../src/utils/forms';

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
  const { login } = useAuth();
  const { notify } = useFeedback();
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, setError } = useForm<FormValues>({
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
      // A 401 means "wrong email or password" and says nothing about which.
      // Repeating the server's wording keeps it that way.
      const placed = applyFieldErrors(err, setError, ['email', 'password']);
      if (!placed) notify(errorMessage(err), 'error');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthScaffold
      title="Welcome back"
      subtitle="Sign in to manage your jobs, quotes and invoices."
      footer={
        <Stack gap={spacing.md}>
          <Text variant="caption" tone="muted" align="center">
            New to Ruvik?
          </Text>
          {/* Full width rather than a pill hugging the left edge: it is the
              only thing on its row, and a lone control aligned to one side
              reads as a mistake. */}
          <Button
            label="Create an account"
            variant="secondary"
            icon="person-add-outline"
            onPress={() => router.push('/(auth)/sign-up')}
          />
        </Stack>
      }
    >
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

        <View style={{ alignItems: 'flex-end' }}>
          <Text
            variant="caption"
            tone="primary"
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/forgot-password')}
            style={{ paddingVertical: spacing.sm }}
          >
            Forgot your password?
          </Text>
        </View>

        <Button
          label="Sign in"
          icon="arrow-forward"
          iconPosition="right"
          loading={submitting}
          haptic
          onPress={() => void onSubmit()}
        />
      </Stack>
    </AuthScaffold>
  );
}
