import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthScaffold } from '../../src/components/AuthScaffold';
import { Button, Input, Stack, Text, useFeedback } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

/**
 * The second factor.
 *
 * The `mfaToken` is a short-lived ticket, not a session: it proves the
 * password step passed and nothing more. It is carried in the route params
 * rather than stored, so it dies when this screen does.
 */
export default function MfaScreen() {
  const { mfaToken } = useLocalSearchParams<{ mfaToken?: string }>();
  const { verifyMfa } = useAuth();
  const { notify } = useFeedback();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!mfaToken) {
      notify('That sign-in attempt expired. Please start again.', 'error');
      router.replace('/(auth)/sign-in');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(mfaToken, code.trim());
      // The layout redirects as soon as the session lands.
    } catch (err) {
      setError(errorMessage(err, 'That code was not accepted.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScaffold
      title="Two-factor code"
      subtitle="Open your authenticator app and enter the six-digit code."
      onBack={() => router.replace('/(auth)/sign-in')}
    >
      <Stack gap={spacing.md}>
        <Input
          label="Code"
          placeholder="123456"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          leftIcon="keypad-outline"
          maxLength={12}
          autoFocus
          value={code}
          onChangeText={(next) => { setCode(next); setError(null); }}
          error={error ?? undefined}
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
        />

        <Button
          label="Verify"
          icon="shield-checkmark-outline"
          loading={busy}
          disabled={code.trim().length < 6}
          haptic
          onPress={() => void submit()}
        />

        <Text variant="micro" tone="muted" align="center">
          Lost your phone? A recovery code works here too.
        </Text>
      </Stack>
    </AuthScaffold>
  );
}
