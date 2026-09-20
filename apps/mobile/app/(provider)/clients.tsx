import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { router } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Avatar, Badge, Button, Divider, EmptyState, ErrorState, Input, ListRow,
  Screen, SkeletonList,
} from '../../src/components/ui';
import { useClients } from '../../src/features/crm/hooks';
import { useDebounced } from '../../src/hooks/useDebounced';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatRelative, initials, pluralise } from '../../src/utils/format';

export default function ClientsScreen() {
  const theme = useTheme();
  const [term, setTerm] = useState('');
  const query = useDebounced(term);
  const clients = useClients(query.trim() || undefined);

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <PageHeader
          title="Clients"
          trailing={
            <Button
              label="New"
              size="sm"
              icon="person-add-outline"
              fullWidth={false}
              onPress={() => router.push('/client/new')}
            />
          }
        />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Input
          placeholder="Search by name, email or phone"
          leftIcon="search"
          value={term}
          onChangeText={setTerm}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search clients"
        />
      </View>

      {clients.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={5} />
        </View>
      ) : clients.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} />
        </View>
      ) : (
        <FlatList
          data={clients.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: spacing.xxxl }}
          ItemSeparatorComponent={() => <Divider inset={spacing.lg + 52} />}
          onEndReachedThreshold={0.4}
          onEndReached={clients.loadMore}
          refreshing={clients.isRefetching}
          onRefresh={() => void clients.refetch()}
          ListEmptyComponent={
            <View style={{ paddingHorizontal: spacing.lg }}>
              <EmptyState
                icon="people-outline"
                title={query ? 'No match' : 'No clients yet'}
                message={
                  query
                    ? 'Nobody in your book matches that search.'
                    : 'Clients are added automatically when a customer requests a quote, or you can add one yourself.'
                }
                action={query ? undefined : { label: 'Add a client', onPress: () => router.push('/client/new') }}
              />
            </View>
          }
          ListFooterComponent={
            clients.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => (
            <ListRow
              leading={<Avatar initials={initials(item.fullName)} />}
              title={item.fullName}
              subtitle={item.phone ?? item.email ?? item.city ?? undefined}
              meta={
                item.jobCount
                  ? `${pluralise(item.jobCount, 'job')} · last ${formatRelative(item.lastJobAt)}`
                  : 'No jobs yet'
              }
              trailing={
                item.isPlatformCustomer
                  // Worth surfacing: a client with a Ruvik account can accept
                  // quotes and see invoices in their own app, and one without
                  // cannot.
                  ? <Badge label="On Ruvik" tone="primary" />
                  : undefined
              }
              onPress={() => router.push({ pathname: '/client/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}
