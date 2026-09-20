import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';

import { RequireSession } from '../../src/components/Guard';
import {
  Badge, Banner, Button, Card, ConfirmSheet, Input, ScreenScroll,
  SectionHeader, Sheet, Stack, Text, useFeedback,
} from '../../src/components/ui';
import {
  useBeginMfaEnrollment, useChangePassword, useConfirmMfaEnrollment, useDisableMfa,
} from '../../src/features/account/hooks';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

export default function SecurityRoute() {
  return (
    <RequireSession>
      <SecurityScreen />
    </RequireSession>
  );
}

function SecurityScreen() {
  const { user, sessionAal, refreshUser } = useAuth();
  const { notify } = useFeedback();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const disableMfa = useDisableMfa();

  const turnOff = async () => {
    try {
      await disableMfa.mutateAsync(disablePassword);
      notify('Two-factor is off.', 'info');
      setDisableOpen(false);
      setDisablePassword('');
      await refreshUser();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Security</Text>
        <Text variant="caption" tone="muted">
          Your password and your second factor.
        </Text>
      </Stack>

      <Card>
        <Stack gap={spacing.sm}>
          <Text variant="heading">Password</Text>
          <Text variant="caption" tone="muted">
            Changing it signs out every other device. This one stays signed in.
          </Text>
          <Button label="Change password" variant="secondary" onPress={() => setPasswordOpen(true)} />
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.sm}>
          <Stack gap={spacing.xs}>
            <Text variant="heading">Two-factor authentication</Text>
            {user?.mfaEnabled ? (
              <Badge label="On" tone="success" />
            ) : (
              <Badge label="Off" tone="neutral" />
            )}
          </Stack>
          <Text variant="caption" tone="muted">
            A six-digit code from an authenticator app, on top of your password.
          </Text>

          {user?.role === 'admin' ? (
            // Worth saying to an admin specifically: the web panel refuses
            // state-changing actions without it, so this is not optional for
            // them in practice.
            <Banner
              tone="info"
              message={
                sessionAal === 'mfa'
                  ? 'This session satisfied the second factor, so administrative actions are available.'
                  : 'Administrative changes in the web panel need a two-factor session.'
              }
            />
          ) : null}

          {user?.mfaEnabled ? (
            <Button label="Turn off two-factor" variant="secondary" onPress={() => setDisableOpen(true)} />
          ) : (
            <Button label="Set up two-factor" onPress={() => setMfaOpen(true)} />
          )}
        </Stack>
      </Card>

      <PasswordSheet visible={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <MfaSheet visible={mfaOpen} onClose={() => setMfaOpen(false)} />

      <ConfirmSheet
        visible={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-factor?"
        message="Your account goes back to a password alone. You can turn it on again at any time."
        confirmLabel="Turn it off"
        busy={disableMfa.isPending}
        onConfirm={() => void turnOff()}
      >
        <Input
          label="Confirm your password"
          secure
          autoCapitalize="none"
          value={disablePassword}
          onChangeText={setDisablePassword}
        />
      </ConfirmSheet>
    </ScreenScroll>
  );
}

function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { notify } = useFeedback();
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 12;

  const submit = async () => {
    try {
      const result = await change.mutateAsync({ currentPassword, newPassword });
      notify(result.message, 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Change password">
      <Input
        label="Current password"
        secure
        autoCapitalize="none"
        textContentType="password"
        value={currentPassword}
        onChangeText={setCurrentPassword}
      />
      <Input
        label="New password"
        secure
        autoCapitalize="none"
        textContentType="newPassword"
        hint="At least 12 characters. A phrase you will remember beats a puzzle you will not."
        error={tooShort ? 'Use at least 12 characters.' : undefined}
        value={newPassword}
        onChangeText={setNewPassword}
      />
      <Input
        label="Confirm new password"
        secure
        autoCapitalize="none"
        error={mismatch ? 'These do not match.' : undefined}
        value={confirm}
        onChangeText={setConfirm}
      />
      <Button
        label="Update password"
        disabled={!currentPassword || newPassword.length < 12 || mismatch}
        loading={change.isPending}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}

/**
 * Enrolment in two steps: get the secret, then prove the app can generate a
 * code from it. Recovery codes come back once, at the end, and are never
 * retrievable again — which is exactly why the screen says so before
 * dismissing them.
 */
function MfaSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { notify } = useFeedback();
  const { refreshUser } = useAuth();
  const begin = useBeginMfaEnrollment();
  const confirmEnrollment = useConfirmMfaEnrollment();

  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const start = async () => {
    try {
      setSecret(await begin.mutateAsync());
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const finish = async () => {
    try {
      const result = await confirmEnrollment.mutateAsync(code.trim());
      setRecoveryCodes(result.recoveryCodes);
      await refreshUser();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const close = () => {
    setSecret(null);
    setCode('');
    setRecoveryCodes(null);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Set up two-factor">
      {recoveryCodes ? (
        <>
          <Banner
            tone="warning"
            title="Save these now"
            message="Recovery codes are shown once. Each works a single time if you lose your phone."
          />
          <Card>
            <Stack gap={4}>
              {recoveryCodes.map((recoveryCode) => (
                <Text key={recoveryCode} variant="bodyStrong" selectable>{recoveryCode}</Text>
              ))}
            </Stack>
          </Card>
          <Button
            label="Copy all codes"
            variant="secondary"
            icon="copy-outline"
            onPress={() => {
              void Clipboard.setStringAsync(recoveryCodes.join('\n'));
              notify('Copied. Put them somewhere safe.', 'success');
            }}
          />
          <Button label="Done" onPress={close} />
        </>
      ) : secret ? (
        <>
          <Text variant="caption" tone="muted">
            Add this key to your authenticator app, then enter the code it shows.
          </Text>
          <Card>
            <Stack gap={spacing.xs}>
              <Text variant="micro" tone="muted" uppercase>Setup key</Text>
              <Text variant="bodyStrong" selectable>{secret.secret}</Text>
            </Stack>
          </Card>
          <Button
            label="Copy key"
            variant="secondary"
            icon="copy-outline"
            onPress={() => {
              void Clipboard.setStringAsync(secret.secret);
              notify('Key copied.', 'success');
            }}
          />
          <Input
            label="Code from your app"
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={8}
            value={code}
            onChangeText={setCode}
          />
          <Button
            label="Turn on two-factor"
            disabled={code.trim().length < 6}
            loading={confirmEnrollment.isPending}
            onPress={() => void finish()}
          />
        </>
      ) : (
        <>
          <SectionHeader title="How it works" />
          <Text variant="caption" tone="muted">
            You will need an authenticator app — Google Authenticator, 1Password, Authy or
            similar. Ruvik gives you a key, the app turns it into a rotating code, and you enter
            that code when you sign in.
          </Text>
          <Button label="Get my setup key" loading={begin.isPending} onPress={() => void start()} />
        </>
      )}
    </Sheet>
  );
}
