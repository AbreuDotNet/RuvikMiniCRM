import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Button, Card, EmptyState, Input, ListRow, ScreenScroll, Sheet,
  Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useClients, useCreateJob } from '../../src/features/crm/hooks';
import { useDebounced } from '../../src/hooks/useDebounced';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { applyFieldErrors } from '../../src/utils/forms';

const schema = z.object({
  title: z.string().trim().min(3, 'Give the job a short title.').max(160),
  description: z.string().trim().max(4000).optional(),
  addressLine: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(2).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewJobRoute() {
  return (
    <RequireRole role="provider">
      <NewJob />
    </RequireRole>
  );
}

function NewJob() {
  const params = useLocalSearchParams<{ clientId?: string }>();
  const { notify } = useFeedback();
  const createJob = useCreateJob();

  const [clientId, setClientId] = useState<string | undefined>(params.clientId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [term, setTerm] = useState('');
  const query = useDebounced(term);
  const clients = useClients(query.trim() || undefined);

  const selected = clients.items.find((client) => client.id === clientId);

  const { control, handleSubmit, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '', description: '', addressLine: '', city: '', region: '', postalCode: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!clientId) {
      notify('Choose a client first — a job belongs to someone.', 'error');
      return;
    }
    try {
      const created = await createJob.mutateAsync({
        clientId,
        title: values.title.trim(),
        description: values.description?.trim() || null,
        addressLine: values.addressLine?.trim() || null,
        city: values.city?.trim() || null,
        region: values.region?.trim() ? values.region.trim().toUpperCase() : null,
        postalCode: values.postalCode?.trim() || null,
      });
      notify(`Job ${created.reference} created.`, 'success');
      router.replace({ pathname: '/job/[id]', params: { id: created.id } });
    } catch (err) {
      const placed = applyFieldErrors(err, setError, [
        'title', 'description', 'addressLine', 'city', 'region', 'postalCode',
      ]);
      if (!placed) notify(errorMessage(err), 'error');
    }
  });

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">New job</Text>
        <Text variant="caption" tone="muted">
          For work you booked directly. Requests from Ruvik arrive as jobs on their own.
        </Text>
      </Stack>

      <Card padded={false}>
        <ListRow
          title={selected ? selected.fullName : 'Choose a client'}
          subtitle={selected ? (selected.phone ?? selected.email ?? undefined) : 'Or add a new one'}
          trailing={
            selected?.isPlatformCustomer
              // Worth knowing before quoting: a client with a Ruvik account
              // can accept the quote in their own app.
              ? <Badge label="On Ruvik" tone="primary" />
              : undefined
          }
          onPress={() => setPickerOpen(true)}
        />
      </Card>

      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Input
            label="What is the job?"
            placeholder="Hallway ceiling patch"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <Input
            label="Notes"
            placeholder="Follow-up after the first repair."
            multiline
            numberOfLines={4}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="addressLine"
        render={({ field, fieldState }) => (
          <Input
            label="Work address"
            placeholder="2405 East 6th Street"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Controller
          control={control}
          name="city"
          render={({ field, fieldState }) => (
            <Input
              containerStyle={{ flex: 2 }}
              label="City"
              placeholder="Austin"
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="region"
          render={({ field, fieldState }) => (
            <Input
              containerStyle={{ flex: 1 }}
              label="State"
              placeholder="TX"
              autoCapitalize="characters"
              maxLength={2}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </View>

      <Controller
        control={control}
        name="postalCode"
        render={({ field, fieldState }) => (
          <Input
            label="ZIP code"
            placeholder="78702"
            keyboardType="number-pad"
            // The invoice snapshots this as its tax jurisdiction, so leaving
            // it blank now costs an edit later.
            hint="The invoice takes its sales-tax jurisdiction from here."
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Button
        label="Create job"
        disabled={!clientId}
        loading={createJob.isPending}
        onPress={() => void onSubmit()}
      />

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose a client"
      >
        <Input
          placeholder="Search your clients"
          leftIcon="search"
          value={term}
          onChangeText={setTerm}
          autoCapitalize="none"
        />
        {clients.isPending ? (
          <Text variant="caption" tone="muted">Loading…</Text>
        ) : !clients.items.length ? (
          <EmptyState
            icon="people-outline"
            title={query ? 'No match' : 'No clients yet'}
            message="Add the client first, then come back to create the job."
            action={{
              label: 'Add a client',
              onPress: () => { setPickerOpen(false); router.push('/client/new'); },
            }}
          />
        ) : (
          clients.items.map((client) => (
            <ListRow
              key={client.id}
              title={client.fullName}
              subtitle={client.phone ?? client.email ?? client.city ?? undefined}
              onPress={() => { setClientId(client.id); setPickerOpen(false); }}
            />
          ))
        )}
      </Sheet>
    </ScreenScroll>
  );
}
