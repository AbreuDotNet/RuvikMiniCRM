import { View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequireRole } from '../../src/components/Guard';
import {
  Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useCreateClient } from '../../src/features/crm/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { applyFieldErrors } from '../../src/utils/forms';

const schema = z.object({
  fullName: z.string().trim().min(2, 'What is their name?').max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email('That does not look like an email.').optional().or(z.literal('')),
  addressLine: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(2).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewClientRoute() {
  return (
    <RequireRole role="provider">
      <NewClient />
    </RequireRole>
  );
}

function NewClient() {
  const { notify } = useFeedback();
  const create = useCreateClient();

  const { control, handleSubmit, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '', phone: '', email: '', addressLine: '', city: '', region: '', postalCode: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await create.mutateAsync({
        fullName: values.fullName.trim(),
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        addressLine: values.addressLine?.trim() || null,
        city: values.city?.trim() || null,
        region: values.region?.trim() ? values.region.trim().toUpperCase() : null,
        postalCode: values.postalCode?.trim() || null,
      });
      notify('Client added.', 'success');
      router.replace({ pathname: '/client/[id]', params: { id: created.id } });
    } catch (err) {
      const placed = applyFieldErrors(err, setError, [
        'fullName', 'phone', 'email', 'addressLine', 'city', 'region', 'postalCode',
      ]);
      if (!placed) notify(errorMessage(err), 'error');
    }
  });

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">New client</Text>
        <Text variant="caption" tone="muted">
          Only a name is required. The rest saves you typing later.
        </Text>
      </Stack>

      <Controller
        control={control}
        name="fullName"
        render={({ field, fieldState }) => (
          <Input
            label="Name"
            placeholder="Ana Torres"
            autoComplete="name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            required
          />
        )}
      />

      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <Input
            label="Phone"
            placeholder="(512) 555-0142"
            keyboardType="phone-pad"
            autoComplete="tel"
            leftIcon="call-outline"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            label="Email"
            placeholder="ana@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            leftIcon="mail-outline"
            // Worth saying: matching the address is what links this client to
            // their Ruvik account, which is what lets them accept a quote in
            // their own app.
            hint="If they have a Ruvik account, this is what links them to it."
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
            label="Address"
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
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Button label="Add client" loading={create.isPending} onPress={() => void onSubmit()} />
    </ScreenScroll>
  );
}
