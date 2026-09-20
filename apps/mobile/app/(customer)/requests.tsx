import { ActivityIndicator, FlatList, View } from 'react-native';
import { router } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Card, EmptyState, ErrorState, Screen, SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useCustomerRequests } from '../../src/features/customer/hooks';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatDate, pluralise } from '../../src/utils/format';
import { jobStatus } from '../../src/utils/status';

export default function RequestsScreen() {
  const theme = useTheme();
  const requests = useCustomerRequests();

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <PageHeader title="Requests" subtitle="Every job you have asked for." />
      </View>

      {requests.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={4} />
        </View>
      ) : requests.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        </View>
      ) : (
        <FlatList
          data={requests.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxxl,
            gap: spacing.md,
          }}
          onEndReachedThreshold={0.4}
          onEndReached={requests.loadMore}
          refreshing={requests.isRefetching}
          onRefresh={() => void requests.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No requests yet"
              message="When you ask a professional for a quote, it shows up here with its status."
              action={{ label: 'Find a professional', onPress: () => router.push('/(customer)/search') }}
            />
          }
          ListFooterComponent={
            requests.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => {
            const look = jobStatus(item.status);
            const counts = [
              item.quoteCount ? pluralise(item.quoteCount, 'quote') : null,
              item.invoiceCount ? pluralise(item.invoiceCount, 'invoice') : null,
            ].filter(Boolean).join(' · ');

            return (
              <Card
                style={{ padding: 0 }}
                padded={false}
              >
                <View style={{ padding: spacing.lg, gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong" numberOfLines={2}>{item.title}</Text>
                      <Text variant="caption" tone="muted">{item.provider.businessName}</Text>
                    </View>
                    <Badge label={look.label} tone={look.tone} />
                  </View>

                  <Stack gap={2}>
                    <Text variant="micro" tone="faint">
                      {item.reference} · opened {formatDate(item.createdAt)}
                    </Text>
                    {counts ? <Text variant="micro" tone="muted">{counts}</Text> : null}
                    {item.canReview ? (
                      <Text variant="micro" tone="primary">Ready for your review</Text>
                    ) : null}
                  </Stack>

                  <Text
                    variant="caption"
                    tone="primary"
                    onPress={() => router.push({ pathname: '/request/[id]', params: { id: item.id } })}
                    accessibilityRole="link"
                    style={{ paddingTop: spacing.xs }}
                  >
                    Open request →
                  </Text>
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
