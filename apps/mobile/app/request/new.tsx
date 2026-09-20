import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequireRole } from '../../src/components/Guard';
import {
  Banner, Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useCreateRequest } from '../../src/features/customer/hooks';
import { errorMessage } from '../../src/services/api';
import { applyFieldErrors } from '../../src/utils/forms';
import { spacing } from '../../src/theme/tokens';

const schema = z.object({
  title: z.string().trim().min(3, 'Give it a short title.').max(160),
  description: z.string().trim().min(10, 'A sentence or two helps them quote accurately.').max(2000),
  addressLine: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  // Two letters, uppercase — the server sources sales tax to the state the
  // work is in, and rejects anything else.
  region: z.string().trim().length(2, 'Use the two-letter state code, e.g. TX.').optional()
    .or(z.literal('')),
  postalCode: z.string().trim().max(20).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewRequestRoute() {
  return (
    <RequireRole role="customer">
      <NewRequest />
    </RequireRole>
  );
}

function NewRequest() {
  const params = useLocalSearchParams<{ providerId?: string; serviceId?: string; title?: string }>();
  const { notify } = useFeedback();
  const create = useCreateRequest();

  const { control, handleSubmit, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: params.title ?? '',
      description: '',
      addressLine: '',
      city: '',
      region: '',
      postalCode: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!params.providerId) {
      notify('We lost track of which professional this is for. Please start again.', 'error');
      return;
    }
    try {
      const created = await create.mutateAsync({
        providerId: params.providerId,
        serviceId: params.serviceId ?? null,
        title: values.title.trim(),
        description: values.description.trim(),
        addressLine: values.addressLine?.trim() || null,
        city: values.city?.trim() || null,
        region: values.region?.trim() ? values.region.trim().toUpperCase() : null,
        postalCode: values.postalCode?.trim() || null,
      });
      notify(`Sent to ${created.providerName}. They will be in touch.`, 'success');
      router.replace({ pathname: '/request/[id]', params: { id: created.id } });
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
        <Text variant="title" accessibilityRole="header">Tell them what you need</Text>
        <Text variant="caption" tone="muted">
          The more specific you are, the more accurate the quote.
        </Text>
      </Stack>

      <Banner
        tone="info"
        message="Asking for a quote is free and commits you to nothing. You decide whether to accept it."
      />

      <Stack gap={spacing.md}>
        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <Input
              label="What needs doing"
              placeholder="Repair water-damaged ceiling"
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
              label="Details"
              placeholder="About two square metres of the hallway ceiling, water damage from a leak that has been fixed."
              multiline
              numberOfLines={5}
              value={field.value}
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
              label="Street address"
              placeholder="2405 East 6th Street"
              autoComplete="street-address"
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Stack gap={spacing.md} style={{ flexDirection: 'row' }}>
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
        </Stack>

        <Controller
          control={control}
          name="postalCode"
          render={({ field, fieldState }) => (
            <Input
              label="ZIP code"
              placeholder="78702"
              keyboardType="number-pad"
              hint="Where the work happens decides which sales tax applies."
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </Stack>

      <Button
        label="Send request"
        loading={create.isPending}
        haptic
        onPress={() => void onSubmit()}
      />
    </ScreenScroll>
  );
}
