import { useState } from 'react';

import { RequireSession } from '../../src/components/Guard';
import {
  Banner, Button, Card, ConfirmSheet, DetailRow, ErrorState, Input,
  ScreenScroll, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import {
  useOptInWhatsApp, useOptOutWhatsApp, useWhatsAppConsent,
} from '../../src/features/account/hooks';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { formatDate } from '../../src/utils/format';

export default function MessagingRoute() {
  return (
    <RequireSession>
      <Messaging />
    </RequireSession>
  );
}

/**
 * WhatsApp consent.
 *
 * Opting in is an explicit act with an explicit acknowledgement — the server
 * requires a literal `acknowledged: true` and records when it was given.
 * Nothing here can tick that box on someone's behalf, and opting out takes
 * effect immediately rather than "within 48 hours".
 */
function Messaging() {
  const { notify } = useFeedback();
  const { refreshUser } = useAuth();
  const consent = useWhatsAppConsent();
  const optIn = useOptInWhatsApp();
  const optOut = useOptOutWhatsApp();

  const [phone, setPhone] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);

  if (consent.isPending) {
    return <ScreenScroll><SkeletonList rows={2} /></ScreenScroll>;
  }
  if (consent.isError || !consent.data) {
    return (
      <ScreenScroll>
        <ErrorState error={consent.error} onRetry={() => void consent.refetch()} />
      </ScreenScroll>
    );
  }

  const turnOn = async () => {
    try {
      await optIn.mutateAsync(phone.trim());
      notify('WhatsApp updates are on.', 'success');
      setPhone('');
      await refreshUser();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const turnOff = async () => {
    try {
      await optOut.mutateAsync();
      notify('WhatsApp updates are off.', 'info');
      setConfirmOut(false);
      await refreshUser();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">WhatsApp updates</Text>
        <Text variant="caption" tone="muted">
          Quotes, invoices and job updates, sent to your WhatsApp number.
        </Text>
      </Stack>

      {consent.data.optedIn ? (
        <>
          <Banner
            tone="success"
            title="Turned on"
            message="You will get quote and invoice updates on WhatsApp. Nothing else."
          />
          <Card>
            <Stack gap={2}>
              <DetailRow label="Number" value={consent.data.phone ?? '—'} />
              {consent.data.optInAt ? (
                <DetailRow label="Agreed on" value={formatDate(consent.data.optInAt)} />
              ) : null}
            </Stack>
          </Card>
          <Button
            label="Turn off WhatsApp updates"
            variant="secondary"
            onPress={() => setConfirmOut(true)}
          />
        </>
      ) : (
        <>
          <Card>
            <Stack gap={spacing.sm}>
              <Text variant="heading">Before you turn this on</Text>
              <Text variant="caption" tone="muted">
                By continuing you agree to receive WhatsApp messages from Ruvik about your quotes,
                invoices and jobs. Standard message rates may apply. You can turn it off here at
                any time, and it stops immediately.
              </Text>
            </Stack>
          </Card>

          <Input
            label="WhatsApp number"
            placeholder="+1 512 555 0142"
            keyboardType="phone-pad"
            leftIcon="logo-whatsapp"
            hint="Include the country code."
            value={phone}
            onChangeText={setPhone}
          />

          <Button
            label="I agree — turn it on"
            disabled={phone.trim().length < 8}
            loading={optIn.isPending}
            onPress={() => void turnOn()}
          />
        </>
      )}

      <ConfirmSheet
        visible={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Turn off WhatsApp updates?"
        message="This takes effect immediately. You will still get notifications in the app and by email."
        confirmLabel="Turn it off"
        busy={optOut.isPending}
        onConfirm={() => void turnOff()}
      />
    </ScreenScroll>
  );
}
