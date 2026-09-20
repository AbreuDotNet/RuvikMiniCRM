import { useState } from 'react';
import { router } from 'expo-router';

import { AuthScaffold } from '../../src/components/AuthScaffold';
import {
  Banner, Button, Input, Stack, useFeedback,
} from '../../src/components/ui';
import { useRequestPasswordReset } from '../../src/features/account/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

export default function ForgotPassword() {
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
    <AuthScaffold
      title={sent ? 'Check your email' : 'Reset your password'}
      subtitle={
        sent
          ? undefined
          : 'We will email you a link. It expires shortly, so use it soon.'
      }
      onBack={() => router.back()}
    >
      {sent ? (
        <Stack gap={spacing.lg}>
          <Banner
            tone="success"
            message={`If an account exists for ${email.trim()}, a reset link is on its way. The link opens in your browser.`}
          />
          <Button
            label="Back to sign in"
            icon="arrow-back"
            onPress={() => router.replace('/(auth)/sign-in')}
          />
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
            autoFocus
          />
          <Button
            label="Send reset link"
            icon="paper-plane-outline"
            loading={request.isPending}
            disabled={!email.includes('@')}
            onPress={() => void submit()}
          />
        </Stack>
      )}
    </AuthScaffold>
  );
}
