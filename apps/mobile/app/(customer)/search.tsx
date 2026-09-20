import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, FilterBar, Input, Screen, Segmented,
  Sheet, SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useCategories, useServiceSearch } from '../../src/features/discovery/hooks';
import { useDebounced } from '../../src/hooks/useDebounced';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatMoney } from '../../src/utils/format';
import type { ServiceCard } from '../../src/types/api';

const SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price_asc', label: 'Cheapest' },
] as const;

export default function SearchScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ category?: string }>();

  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [city, setCity] = useState('');
  const [sort, setSort] = useState<string>('relevance');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const debouncedTerm = useDebounced(term);
  const debouncedCity = useDebounced(city);

  const filters = useMemo(() => ({
    q: debouncedTerm.trim() || undefined,
    category,
    city: debouncedCity.trim() || undefined,
    sort,
    verifiedOnly: verifiedOnly || undefined,
  }), [debouncedTerm, category, debouncedCity, sort, verifiedOnly]);

  const search = useServiceSearch(filters);
  const categories = useCategories();

  const activeFilterCount = [category, debouncedCity.trim() || undefined, verifiedOnly || undefined]
    .filter(Boolean).length;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <PageHeader title="Find a pro" />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <Input
          placeholder="Plumber, painter, drywall…"
          leftIcon="search"
          value={term}
          onChangeText={setTerm}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search services"
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Segmented
              options={SORTS.map((s) => ({ value: s.value as string, label: s.label }))}
              value={sort}
              onChange={setSort}
            />
          </View>
          <Button
            label={activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters'}
            variant="secondary"
            size="sm"
            icon="options-outline"
            fullWidth={false}
            onPress={() => setFiltersOpen(true)}
          />
        </View>
      </View>

      {categories.data?.length ? (
        <FilterBar>
          <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
          {categories.data.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={category === c.slug}
              onPress={() => setCategory(category === c.slug ? undefined : c.slug)}
            />
          ))}
        </FilterBar>
      ) : null}

      {search.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={4} />
        </View>
      ) : search.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        </View>
      ) : (
        <FlatList
          data={search.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxxl,
            gap: spacing.md,
          }}
          onEndReachedThreshold={0.4}
          onEndReached={search.loadMore}
          refreshing={search.isRefetching}
          onRefresh={() => void search.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="Nothing matched"
              message="Try a broader term, or clear the filters and start again."
              action={activeFilterCount ? {
                label: 'Clear filters',
                onPress: () => { setCategory(undefined); setCity(''); setVerifiedOnly(false); },
              } : undefined}
            />
          }
          ListFooterComponent={
            search.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => <ServiceResult service={item} />}
        />
      )}

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        subtitle="Narrow the list to what you actually need."
      >
        <Input
          label="City"
          placeholder="Austin"
          value={city}
          onChangeText={setCity}
        />
        <Segmented
          label="Verification"
          options={[
            { value: 'any', label: 'Anyone' },
            { value: 'verified', label: 'Verified only' },
          ]}
          value={verifiedOnly ? 'verified' : 'any'}
          onChange={(next) => setVerifiedOnly(next === 'verified')}
        />
        <Button label="Show results" onPress={() => setFiltersOpen(false)} />
        <Button
          label="Clear all"
          variant="ghost"
          onPress={() => {
            setCategory(undefined);
            setCity('');
            setVerifiedOnly(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}

function ServiceResult({ service }: { service: ServiceCard }) {
  const price = service.pricingType === 'request_quote'
    ? 'Price on request'
    : `${service.pricingType === 'starting_at' ? 'From ' : ''}${formatMoney(service.priceCents, service.currency)}`;

  return (
    <Card>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={2}>{service.title}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {service.provider.businessName}
              {service.provider.city ? ` · ${service.provider.city}` : ''}
            </Text>
          </View>
          {service.provider.verificationStatus === 'verified' ? (
            <Badge label="Verified" tone="success" icon="shield-checkmark" />
          ) : null}
        </View>

        {service.shortDescription ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>{service.shortDescription}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Text variant="bodyStrong" tone="primary">{price}</Text>
          {service.provider.ratingCount > 0 ? (
            <Text variant="caption" tone="muted">
              {service.provider.ratingAvg.toFixed(1)} ★ ({service.provider.ratingCount})
            </Text>
          ) : (
            <Text variant="caption" tone="faint">No reviews yet</Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            label="View service"
            variant="secondary"
            size="sm"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/service/[id]', params: { id: service.id } })}
          />
          <Button
            label="Request quote"
            size="sm"
            style={{ flex: 1 }}
            onPress={() => router.push({
              pathname: '/request/new',
              params: { providerId: service.provider.id, serviceId: service.id },
            })}
          />
        </View>
      </Stack>
    </Card>
  );
}
