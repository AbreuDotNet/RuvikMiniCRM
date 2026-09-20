import { useCallback } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Card, Divider, EmptyState, ErrorState, ListRow, ScreenScroll,
  SectionHeader, SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useCustomerHome } from '../../src/features/customer/hooks';
import { useCategories, useFeaturedProviders } from '../../src/features/discovery/hooks';
import { useAuth } from '../../src/state/auth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, spacing } from '../../src/theme/tokens';
import { formatRelative, initials } from '../../src/utils/format';
import { jobStatus } from '../../src/utils/status';

export default function CustomerHome() {
  const { user } = useAuth();
  const home = useCustomerHome();
  const categories = useCategories();
  const featured = useFeaturedProviders(6);

  const refresh = useCallback(() => {
    void home.refetch();
    void featured.refetch();
  }, [home, featured]);

  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <ScreenScroll refreshing={home.isRefetching} onRefresh={refresh}>
      <PageHeader title={`Hi, ${firstName}`} subtitle="What needs doing today?" />

      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search for a service"
        onPress={() => router.push('/(customer)/search')}
      >
        <SearchAffordance />
      </Pressable>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Browse by trade" />
        {categories.isPending ? (
          <Text variant="caption" tone="faint">Loading categories…</Text>
        ) : categories.isError ? (
          <Text variant="caption" tone="muted">Categories are unavailable right now.</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
          >
            {(categories.data ?? []).map((category) => (
              <CategoryTile
                key={category.id}
                name={category.name}
                count={category.serviceCount}
                onPress={() => router.push({
                  pathname: '/(customer)/search',
                  params: { category: category.slug },
                })}
              />
            ))}
          </ScrollView>
        )}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title="Your requests"
          action={{ label: 'See all', onPress: () => router.push('/(customer)/requests') }}
        />
        {home.isPending ? (
          <SkeletonList rows={2} />
        ) : home.isError ? (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        ) : !home.data?.recentRequests.length ? (
          <Card>
            <EmptyState
              icon="sparkles-outline"
              title="No requests yet"
              message="Find a professional and ask for a quote. It is free, and you only pay when you accept one."
              action={{ label: 'Find a professional', onPress: () => router.push('/(customer)/search') }}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {home.data.recentRequests.map((request, index) => {
              const look = jobStatus(request.status);
              return (
                <View key={request.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={request.title}
                    subtitle={request.providerName}
                    meta={`${request.reference} · ${formatRelative(request.createdAt)}`}
                    trailing={<Badge label={look.label} tone={look.tone} />}
                    accessibilityHint={look.hint}
                    onPress={() => router.push({
                      pathname: '/request/[id]', params: { id: request.id },
                    })}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Highly rated near you" />
        {featured.isPending ? (
          <SkeletonList rows={2} />
        ) : featured.isError ? (
          <Text variant="caption" tone="muted">We could not load these just now.</Text>
        ) : !featured.data?.length ? (
          <Card>
            <Text variant="caption" tone="muted">
              No published professionals yet. Try the search tab.
            </Text>
          </Card>
        ) : (
          <Card padded={false}>
            {featured.data.map((provider, index) => (
              <View key={provider.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <ListRow
                  leading={<InitialsBubble name={provider.businessName} />}
                  title={provider.businessName}
                  subtitle={provider.primaryCategory ?? provider.tagline ?? provider.city ?? undefined}
                  meta={
                    provider.ratingCount > 0
                      ? `${provider.ratingAvg.toFixed(1)} ★ · ${provider.completedJobs} jobs completed`
                      : 'New on Ruvik'
                  }
                  trailing={
                    provider.verificationStatus === 'verified'
                      ? <Badge label="Verified" tone="success" icon="shield-checkmark" />
                      : undefined
                  }
                  onPress={() => router.push({
                    pathname: '/provider/[slug]', params: { slug: provider.slug },
                  })}
                />
              </View>
            ))}
          </Card>
        )}
      </Stack>
    </ScreenScroll>
  );
}

function SearchAffordance() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        minHeight: 50,
      }}
    >
      <Ionicons name="search" size={18} color={theme.colors.textFaint} />
      <Text variant="body" tone="faint">Plumber, painter, drywall…</Text>
    </View>
  );
}

function CategoryTile({
  name, count, onPress,
}: {
  name: string;
  count: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count} listings`}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 120,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        gap: 2,
      })}
    >
      <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
      <Text variant="micro" tone="faint">{count} listing{count === 1 ? '' : 's'}</Text>
    </Pressable>
  );
}

function InitialsBubble({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 40, height: 40, borderRadius: 20,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.colors.primaryMuted,
      }}
    >
      <Text variant="caption" style={{ color: theme.colors.primary }}>{initials(name)}</Text>
    </View>
  );
}
