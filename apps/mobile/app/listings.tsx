import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { RequireRole } from '../src/components/Guard';
import {
  Badge, Banner, Button, Card, ConfirmSheet, Divider, EmptyState, ErrorState,
  Input, ListRow, ScreenScroll, Segmented, Sheet, SkeletonList, Stack, Text, useFeedback,
} from '../src/components/ui';
import { useCategories } from '../src/features/discovery/hooks';
import {
  useCreateService, useDeleteService, useProviderServices, useUpdateService,
  type ServiceInput,
} from '../src/features/provider/hooks';
import { useSubscription } from '../src/features/billing/hooks';
import { errorMessage } from '../src/services/api';
import { spacing } from '../src/theme/tokens';
import { formatMoney } from '../src/utils/format';
import { centsToInput, parseAmountToCents } from '../src/utils/moneyInput';
import type { ProviderService } from '../src/types/api';

export default function ListingsRoute() {
  return (
    <RequireRole role="provider">
      <Listings />
    </RequireRole>
  );
}

function Listings() {
  const services = useProviderServices();
  const subscription = useSubscription();
  const [editing, setEditing] = useState<ProviderService | null>(null);
  const [creating, setCreating] = useState(false);

  // The cap is enforced on the server. Showing it here only means the limit
  // is visible before the refusal rather than after it.
  const max = subscription.data?.plan.maxServices ?? null;
  const used = services.data?.length ?? 0;
  const atCap = max !== null && used >= max;

  return (
    <ScreenScroll refreshing={services.isRefetching} onRefresh={() => void services.refetch()}>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">My listings</Text>
        <Text variant="caption" tone="muted">
          What customers find when they search. Only active listings appear.
        </Text>
      </Stack>

      {atCap ? (
        <Banner
          tone="warning"
          title="You have used every listing on your plan"
          message={`Your plan allows ${max}. Pause or remove one, or move to a plan with more room.`}
          action={{ label: 'See plans', onPress: () => router.push('/subscription') }}
        />
      ) : null}

      <Button
        label="Add a listing"
        icon="add"
        disabled={atCap}
        onPress={() => setCreating(true)}
      />

      {services.isPending ? (
        <SkeletonList rows={3} />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={() => void services.refetch()} />
      ) : !services.data?.length ? (
        <Card>
          <EmptyState
            icon="pricetags-outline"
            title="No listings yet"
            message="A listing is one service you offer, with a price or a note that you quote per job."
            action={{ label: 'Create your first', onPress: () => setCreating(true) }}
          />
        </Card>
      ) : (
        <Card padded={false}>
          {services.data.map((service, index) => (
            <View key={service.id}>
              {index > 0 ? <Divider inset={spacing.lg} /> : null}
              <ListRow
                title={service.title}
                subtitle={service.category?.name ?? service.shortDescription ?? undefined}
                meta={
                  service.pricingType === 'request_quote'
                    ? 'Quoted per job'
                    : `${service.pricingType === 'starting_at' ? 'From ' : ''}${formatMoney(service.priceCents, service.currency)}`
                }
                trailing={
                  <Badge
                    label={service.status}
                    tone={
                      service.status === 'active' ? 'success'
                        : service.status === 'paused' ? 'warning' : 'neutral'
                    }
                  />
                }
                onPress={() => setEditing(service)}
              />
            </View>
          ))}
        </Card>
      )}

      {max !== null ? (
        <Text variant="micro" tone="faint" align="center">
          {used} of {max} listings used on your plan.
        </Text>
      ) : null}

      <ServiceSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onDone={() => setCreating(false)}
      />

      {editing ? (
        <ServiceSheet
          visible
          service={editing}
          onClose={() => setEditing(null)}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </ScreenScroll>
  );
}

function ServiceSheet({
  visible, service, onClose, onDone,
}: {
  visible: boolean;
  service?: ProviderService;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useFeedback();
  const categories = useCategories();
  const create = useCreateService();
  const update = useUpdateService();
  const remove = useDeleteService();

  const [title, setTitle] = useState(service?.title ?? '');
  const [categoryId, setCategoryId] = useState(service?.category?.id ?? '');
  const [shortDescription, setShortDescription] = useState(service?.shortDescription ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [pricingType, setPricingType] = useState<ServiceInput['pricingType']>(
    service?.pricingType ?? 'starting_at',
  );
  const [price, setPrice] = useState(
    service?.priceCents != null ? centsToInput(service.priceCents) : '',
  );
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>(service?.status ?? 'active');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const parsedPrice = parseAmountToCents(price || '0');
  const needsPrice = pricingType !== 'request_quote';

  const save = async () => {
    const payload: ServiceInput = {
      categoryId,
      title: title.trim(),
      shortDescription: shortDescription.trim() || null,
      description: description.trim() || null,
      pricingType,
      // The server mirrors a database CHECK here: a quote-based listing must
      // not carry a price, and a priced one must.
      priceCents: needsPrice ? parsedPrice.cents : null,
      status,
    };

    try {
      if (service) {
        await update.mutateAsync({ id: service.id, input: payload });
        notify('Listing updated.', 'success');
      } else {
        await create.mutateAsync(payload);
        notify('Listing created.', 'success');
      }
      onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const destroy = async () => {
    if (!service) return;
    try {
      await remove.mutateAsync(service.id);
      notify('Listing removed.', 'info');
      setConfirmDelete(false);
      onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const busy = create.isPending || update.isPending;
  const valid = title.trim().length >= 3 && categoryId
    && (!needsPrice || (parsedPrice.cents !== null && parsedPrice.cents > 0));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={service ? 'Edit listing' : 'New listing'}
    >
      <Input label="Title" placeholder="Drywall repair" value={title} onChangeText={setTitle} />

      <Stack gap={spacing.sm}>
        <Text variant="caption" tone="muted">Category</Text>
        {categories.isPending ? (
          <Text variant="caption" tone="faint">Loading…</Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {(categories.data ?? []).map((category) => (
              <ListRow
                key={category.id}
                title={category.name}
                trailing={
                  categoryId === category.id ? <Badge label="Selected" tone="primary" /> : undefined
                }
                onPress={() => setCategoryId(category.id)}
              />
            ))}
          </View>
        )}
      </Stack>

      <Input
        label="One-line summary"
        placeholder="Patching, taping and finishing"
        value={shortDescription}
        onChangeText={setShortDescription}
      />

      <Input
        label="Full description"
        placeholder="What the job includes, what it does not, and anything a customer should know."
        multiline
        numberOfLines={4}
        value={description}
        onChangeText={setDescription}
      />

      <Segmented
        label="Pricing"
        options={[
          { value: 'fixed' as const, label: 'Fixed' },
          { value: 'starting_at' as const, label: 'From' },
          { value: 'request_quote' as const, label: 'Quote' },
        ]}
        value={pricingType}
        onChange={setPricingType}
      />

      {needsPrice ? (
        <Input
          label="Price"
          placeholder="150.00"
          keyboardType="decimal-pad"
          leftIcon="cash-outline"
          value={price}
          onChangeText={setPrice}
          error={price ? parsedPrice.error : undefined}
        />
      ) : (
        <Banner
          tone="info"
          message="Quote-based listings show no price. Customers ask, and you quote per job."
        />
      )}

      <Segmented
        label="Visibility"
        options={[
          { value: 'active' as const, label: 'Live' },
          { value: 'paused' as const, label: 'Paused' },
          { value: 'draft' as const, label: 'Draft' },
        ]}
        value={status}
        onChange={setStatus}
      />

      <Button
        label={service ? 'Save changes' : 'Create listing'}
        disabled={!valid}
        loading={busy}
        onPress={() => void save()}
      />

      {service ? (
        <Button
          label="Delete listing"
          variant="danger"
          onPress={() => setConfirmDelete(true)}
        />
      ) : null}

      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this listing?"
        message="It disappears from search straight away. Jobs and invoices that came from it are untouched."
        confirmLabel="Delete listing"
        busy={remove.isPending}
        onConfirm={() => void destroy()}
      />
    </Sheet>
  );
}
