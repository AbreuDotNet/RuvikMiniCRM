import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
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
  const insets = useSafeAreaInsets();
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
    <ScreenScroll keyboardAware contentStyle={{ paddingTop: insets.top + spacing.xxl }}>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Two-factor code</Text>
        <Text variant="body" tone="muted">
          Open your authenticator app and enter the six-digit code. A recovery code works too.
        </Text>
      </Stack>

      <Input
        label="Code"
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
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
        loading={busy}
        disabled={code.trim().length < 6}
        onPress={() => void submit()}
      />

      <View style={{ alignItems: 'center' }}>
        <Button
          label="Back to sign in"
          variant="ghost"
          fullWidth={false}
          onPress={() => router.replace('/(auth)/sign-in')}
        />
      </View>
    </ScreenScroll>
  );
}
