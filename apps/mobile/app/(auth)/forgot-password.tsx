import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner, Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useRequestPasswordReset } from '../../src/features/account/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

export default function ForgotPassword() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { notify } = useFeedback();
  const request = useRequestPasswordReset();

  const submit = async () => {
    try {
      await request.mutateAsync(email.trim());
      // The server answers 202 whether or not the address exists, and this
      // screen says the same thing either way. Confirming which emails have
      // accounts is a disclosure, not a courtesy.
      setSent(true);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware contentStyle={{ paddingTop: insets.top + spacing.xxl }}>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Reset your password</Text>
        <Text variant="body" tone="muted">
          We will email you a link. It expires shortly, so use it soon.
        </Text>
      </Stack>

      {sent ? (
        <Stack gap={spacing.lg}>
          <Banner
            tone="success"
            title="Check your email"
            message={`If an account exists for ${email.trim()}, a reset link is on its way. The link opens in your browser.`}
          />
          <Button label="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </Stack>
      ) : (
        <Stack gap={spacing.md}>
          <Input
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            leftIcon="mail-outline"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => void submit()}
            returnKeyType="send"
          />
          <Button
            label="Send reset link"
            loading={request.isPending}
            disabled={!email.includes('@')}
            onPress={() => void submit()}
          />
          <View style={{ alignItems: 'center' }}>
            <Button
              label="Back"
              variant="ghost"
              fullWidth={false}
              onPress={() => router.back()}
            />
          </View>
        </Stack>
      )}
    </ScreenScroll>
  );
}
