import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, Screen, Segmented,
  SkeletonList, Stack, StatTile, Text,
} from '../../src/components/ui';
import { useInvoices } from '../../src/features/invoices/hooks';
import { useQuotes } from '../../src/features/quotes/hooks';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatMoney, formatMoneyCompact } from '../../src/utils/format';
import { invoiceStatus, quoteStatus } from '../../src/utils/status';

const INVOICE_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'partially_paid', label: 'Part paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

const QUOTE_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

export default function MoneyScreen() {
  const params = useLocalSearchParams<{ status?: string; tab?: string }>();
  const [tab, setTab] = useState<'invoices' | 'quotes'>(
    params.tab === 'quotes' ? 'quotes' : 'invoices',
  );

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <PageHeader title="Money" subtitle="Quotes out, invoices in." />
        <Segmented
          options={[
            { value: 'invoices' as const, label: 'Invoices' },
            { value: 'quotes' as const, label: 'Quotes' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'invoices'
        ? <InvoicesTab initialStatus={params.status} />
        : <QuotesTab />}
    </Screen>
  );
}

function InvoicesTab({ initialStatus }: { initialStatus?: string }) {
  const theme = useTheme();
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const invoices = useInvoices(status);

  return (
    <>
      {invoices.data?.summary ? (
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
          }}
        >
          <StatTile
            label="Outstanding"
            value={formatMoneyCompact(invoices.data.summary.outstandingCents)}
            caption="Still owed to you"
            tone={invoices.data.summary.outstandingCents > 0 ? 'warning' : 'neutral'}
          />
          <StatTile
            label="Collected"
            value={formatMoneyCompact(invoices.data.summary.paidCents)}
            caption="Paid in full"
            tone="success"
          />
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        }}
      >
        {INVOICE_FILTERS.map((filter) => (
          <Chip
            key={filter.label}
            label={filter.label}
            selected={status === filter.value}
            onPress={() => setStatus(filter.value)}
          />
        ))}
      </ScrollView>

      {invoices.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={4} />
        </View>
      ) : invoices.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        </View>
      ) : (
        <FlatList
          data={invoices.data?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md,
          }}
          refreshing={invoices.isRefetching}
          onRefresh={() => void invoices.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={status ? 'Nothing with this status' : 'No invoices yet'}
              message={
                status
                  ? 'Try another filter.'
                  : 'Raise an invoice from an accepted quote, or start one from scratch.'
              }
              action={{ label: 'New invoice', onPress: () => router.push('/invoice/new') }}
            />
          }
          ListFooterComponent={
            invoices.isFetching && !invoices.isRefetching
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => {
            const look = invoiceStatus(item.status);
            return (
              <Card>
                <Stack gap={spacing.sm}>
                  <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{item.number}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {item.clientName}
                        {item.job ? ` · ${item.job.title}` : ''}
                      </Text>
                    </View>
                    <Badge label={look.label} tone={look.tone} />
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                    <Text variant="heading">{formatMoney(item.totalCents, item.currency)}</Text>
                    {item.balanceCents > 0 && item.balanceCents !== item.totalCents ? (
                      <Text variant="caption" tone="warning">
                        {formatMoney(item.balanceCents, item.currency)} outstanding
                      </Text>
                    ) : null}
                  </View>

                  <Text variant="micro" tone="faint">
                    Issued {formatDate(item.issueDate)}
                    {item.dueDate ? ` · due ${formatDate(item.dueDate)}` : ''}
                  </Text>

                  <Button
                    label="Open invoice"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: item.id } })}
                  />
                </Stack>
              </Card>
            );
          }}
        />
      )}
    </>
  );
}

function QuotesTab() {
  const theme = useTheme();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const quotes = useQuotes(status);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        }}
      >
        {QUOTE_FILTERS.map((filter) => (
          <Chip
            key={filter.label}
            label={filter.label}
            selected={status === filter.value}
            onPress={() => setStatus(filter.value)}
          />
        ))}
      </ScrollView>

      {quotes.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={4} />
        </View>
      ) : quotes.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={quotes.error} onRetry={() => void quotes.refetch()} />
        </View>
      ) : (
        <FlatList
          data={quotes.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md,
          }}
          onEndReachedThreshold={0.4}
          onEndReached={quotes.loadMore}
          refreshing={quotes.isRefetching}
          onRefresh={() => void quotes.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={status ? 'Nothing with this status' : 'No quotes yet'}
              message="A quote turns a lead into agreed work — and into an invoice once accepted."
              action={{ label: 'New quote', onPress: () => router.push('/quote/new') }}
            />
          }
          ListFooterComponent={
            quotes.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => {
            const look = quoteStatus(item.status);
            return (
              <Card>
                <Stack gap={spacing.sm}>
                  <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{item.number}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {item.clientName} · {item.job.title}
                      </Text>
                    </View>
                    <Badge label={look.label} tone={look.tone} />
                  </View>

                  <Text variant="heading">{formatMoney(item.totalCents, item.currency)}</Text>

                  {item.invoice ? (
                    <Text variant="micro" tone="success">
                      Invoiced as {item.invoice.number}
                    </Text>
                  ) : item.validUntil ? (
                    <Text variant="micro" tone="faint">Valid until {formatDate(item.validUntil)}</Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button
                      label="Open"
                      variant="secondary"
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() => router.push({ pathname: '/quote/[id]', params: { id: item.id } })}
                    />
                    {item.status === 'accepted' && !item.invoice ? (
                      <Button
                        label="Invoice it"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => router.push({
                          pathname: '/invoice/new', params: { quoteId: item.id },
                        })}
                      />
                    ) : null}
                  </View>
                </Stack>
              </Card>
            );
          }}
        />
      )}
    </>
  );
}
