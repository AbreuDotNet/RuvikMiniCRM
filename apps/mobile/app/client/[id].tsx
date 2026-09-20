import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Button, Card, DetailRow, Divider, ErrorState, Input, ListRow,
  ScreenScroll, SectionHeader, Sheet, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useClient, useUpdateClient } from '../../src/features/crm/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { formatDate } from '../../src/utils/format';
import { jobStatus } from '../../src/utils/status';

export default function ClientRoute() {
  return (
    <RequireRole role="provider">
      <ClientDetailScreen />
    </RequireRole>
  );
}

function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clientId = id ?? '';
  const client = useClient(clientId);
  const [editing, setEditing] = useState(false);

  if (client.isPending) {
    return <ScreenScroll><SkeletonList rows={3} /></ScreenScroll>;
  }
  if (client.isError || !client.data) {
    return (
      <ScreenScroll>
        <ErrorState error={client.error} onRetry={() => void client.refetch()} />
      </ScreenScroll>
    );
  }

  const c = client.data;
  const address = [c.addressLine, c.city, c.region, c.postalCode].filter(Boolean).join(', ');

  return (
    <ScreenScroll refreshing={client.isRefetching} onRefresh={() => void client.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>{c.fullName}</Text>
          {c.isPlatformCustomer ? <Badge label="On Ruvik" tone="primary" /> : null}
        </View>
        {c.isPlatformCustomer ? (
          <Text variant="caption" tone="muted">
            This client has a Ruvik account, so they can accept quotes and see invoices in their own app.
          </Text>
        ) : null}
      </Stack>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {c.phone ? (
          <Button
            label="Call"
            variant="secondary"
            icon="call-outline"
            style={{ flex: 1 }}
            onPress={() => void Linking.openURL(`tel:${c.phone}`)}
          />
        ) : null}
        {c.whatsappPhone ? (
          <Button
            label="WhatsApp"
            variant="secondary"
            icon="logo-whatsapp"
            style={{ flex: 1 }}
            onPress={() => void Linking.openURL(
              `https://wa.me/${c.whatsappPhone!.replace(/[^\d]/g, '')}`,
            )}
          />
        ) : null}
      </View>

      <Card>
        <Stack gap={2}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
            <Text variant="heading" style={{ flex: 1 }}>Details</Text>
            <Text
              variant="caption"
              tone="primary"
              accessibilityRole="button"
              onPress={() => setEditing(true)}
            >
              Edit
            </Text>
          </View>
          {c.phone ? <DetailRow label="Phone" value={c.phone} /> : null}
          {c.email ? <DetailRow label="Email" value={c.email} /> : null}
          {address ? <DetailRow label="Address" value={address} /> : null}
          <DetailRow label="Added" value={formatDate(c.createdAt)} />
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title={`Jobs (${c.jobs.length})`}
          action={{
            label: 'New job',
            onPress: () => router.push({ pathname: '/job/new', params: { clientId: c.id } }),
          }}
        />
        {!c.jobs.length ? (
          <Card>
            <Text variant="caption" tone="muted">No jobs for this client yet.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {c.jobs.map((job, index) => {
              const look = jobStatus(job.status);
              return (
                <View key={job.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={job.title}
                    subtitle={job.reference}
                    meta={
                      job.completedAt
                        ? `Completed ${formatDate(job.completedAt)}`
                        : job.scheduledStart
                          ? `Scheduled ${formatDate(job.scheduledStart)}`
                          : `Created ${formatDate(job.createdAt)}`
                    }
                    trailing={<Badge label={look.label} tone={look.tone} />}
                    onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </Stack>

      <EditClientSheet
        visible={editing}
        onClose={() => setEditing(false)}
        clientId={c.id}
        initial={c}
      />
    </ScreenScroll>
  );
}

function EditClientSheet({
  visible, onClose, clientId, initial,
}: {
  visible: boolean;
  onClose: () => void;
  clientId: string;
  initial: {
    fullName: string; phone: string | null; email: string | null;
    addressLine: string | null; city: string | null;
    region?: string | null; postalCode?: string | null;
  };
}) {
  const { notify } = useFeedback();
  const update = useUpdateClient(clientId);

  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? '');
  const [city, setCity] = useState(initial.city ?? '');
  const [region, setRegion] = useState(initial.region ?? '');
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? '');

  const save = async () => {
    try {
      await update.mutateAsync({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        addressLine: addressLine.trim() || null,
        city: city.trim() || null,
        region: region.trim() ? region.trim().toUpperCase() : null,
        postalCode: postalCode.trim() || null,
      });
      notify('Client updated.', 'success');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit client">
      <Input label="Name" value={fullName} onChangeText={setFullName} />
      <Input label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Input
        label="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Input label="Address" value={addressLine} onChangeText={setAddressLine} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Input containerStyle={{ flex: 2 }} label="City" value={city} onChangeText={setCity} />
        <Input
          containerStyle={{ flex: 1 }}
          label="State"
          autoCapitalize="characters"
          maxLength={2}
          value={region}
          onChangeText={setRegion}
        />
      </View>
      <Input
        label="ZIP code"
        keyboardType="number-pad"
        value={postalCode}
        onChangeText={setPostalCode}
      />
      <Button
        label="Save changes"
        disabled={fullName.trim().length < 2}
        loading={update.isPending}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
