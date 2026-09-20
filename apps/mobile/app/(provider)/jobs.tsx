import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, Input, Screen,
  SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useJobs } from '../../src/features/crm/hooks';
import { useDebounced } from '../../src/hooks/useDebounced';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatRelative } from '../../src/utils/format';
import { JOB_FILTERS, jobStatus } from '../../src/utils/status';

export default function JobsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<string | undefined>(params.status);
  const [term, setTerm] = useState('');
  const query = useDebounced(term);

  const jobs = useJobs({ status, q: query.trim() || undefined });

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <PageHeader
          title="Jobs"
          trailing={
            <Button
              label="New"
              size="sm"
              icon="add"
              fullWidth={false}
              onPress={() => router.push('/job/new')}
            />
          }
        />
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <Input
          placeholder="Search by title, reference or client"
          leftIcon="search"
          value={term}
          onChangeText={setTerm}
          autoCorrect={false}
          accessibilityLabel="Search jobs"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        {JOB_FILTERS.map((filter) => (
          <Chip
            key={filter.label}
            label={filter.label}
            selected={status === filter.value}
            onPress={() => setStatus(filter.value)}
          />
        ))}
      </ScrollView>

      {jobs.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={4} />
        </View>
      ) : jobs.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
        </View>
      ) : (
        <FlatList
          data={jobs.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxxl,
            gap: spacing.md,
          }}
          onEndReachedThreshold={0.4}
          onEndReached={jobs.loadMore}
          refreshing={jobs.isRefetching}
          onRefresh={() => void jobs.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="briefcase-outline"
              title={status || query ? 'Nothing here' : 'No jobs yet'}
              message={
                status || query
                  ? 'No job matches this filter. Try another status or clear the search.'
                  : 'Jobs arrive from customer requests, or you can add one yourself.'
              }
              action={
                status || query
                  ? { label: 'Clear filters', onPress: () => { setStatus(undefined); setTerm(''); } }
                  : { label: 'Create a job', onPress: () => router.push('/job/new') }
              }
            />
          }
          ListFooterComponent={
            jobs.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => {
            const look = jobStatus(item.status);
            return (
              <Card>
                <Stack gap={spacing.sm}>
                  <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong" numberOfLines={2}>{item.title}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {item.client.fullName}
                        {item.city ? ` · ${item.city}` : ''}
                      </Text>
                    </View>
                    <Badge label={look.label} tone={look.tone} />
                  </View>

                  <Text variant="micro" tone="faint">
                    {item.reference}
                    {' · '}
                    {item.scheduledStart
                      ? `scheduled ${formatDate(item.scheduledStart)}`
                      : `created ${formatRelative(item.createdAt)}`}
                    {item.quoteCount ? ` · ${item.quoteCount} quote${item.quoteCount === 1 ? '' : 's'}` : ''}
                    {item.invoiceCount ? ` · ${item.invoiceCount} invoice${item.invoiceCount === 1 ? '' : 's'}` : ''}
                  </Text>

                  <Button
                    label="Open job"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.id } })}
                  />
                </Stack>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
