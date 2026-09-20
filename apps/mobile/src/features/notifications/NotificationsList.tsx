import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PageHeader } from '../../components/PageHeader';
import {
  Button, Divider, EmptyState, ErrorState, Screen, SkeletonList, Text,
} from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { formatRelative } from '../../utils/format';
import { clearBadge } from '../../services/push';
import {
  notificationRoute, useMarkAllRead, useMarkNotificationRead, useNotifications,
} from './hooks';

/**
 * The notification centre, shared by all three roles.
 *
 * Tapping opens the thing the notification is about; where the payload does
 * not name one, the row is still marked read rather than being a dead tap.
 */
export function NotificationsList({ showHeader = true }: { showHeader?: boolean }) {
  const theme = useTheme();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  useEffect(() => {
    // Opening the list is the moment the badge stops being true.
    void clearBadge();
  }, []);

  const unreadOnScreen = notifications.items.some((n) => n.readAt === null);

  return (
    <Screen padded={false}>
      {showHeader ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <PageHeader
            title="Alerts"
            trailing={
              unreadOnScreen ? (
                <Button
                  label="Mark all read"
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  loading={markAll.isPending}
                  onPress={() => markAll.mutate()}
                />
              ) : undefined
            }
          />
        </View>
      ) : null}

      {notifications.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList rows={5} />
        </View>
      ) : notifications.isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
        </View>
      ) : (
        <FlatList
          data={notifications.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: spacing.xxxl }}
          ItemSeparatorComponent={() => <Divider inset={spacing.lg} />}
          onEndReachedThreshold={0.4}
          onEndReached={notifications.loadMore}
          refreshing={notifications.isRefetching}
          onRefresh={() => void notifications.refetch()}
          ListEmptyComponent={
            <View style={{ paddingHorizontal: spacing.lg }}>
              <EmptyState
                icon="notifications-outline"
                title="Nothing to catch up on"
                message="Quotes, invoices and job updates will appear here."
              />
            </View>
          }
          ListFooterComponent={
            notifications.isFetchingNextPage
              ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.colors.primary} />
              : null
          }
          renderItem={({ item }) => {
            const unread = item.readAt === null;
            const target = notificationRoute(item);

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.body}`}
                accessibilityHint={target ? 'Opens the related item' : undefined}
                onPress={() => {
                  if (unread) markRead.mutate(item.id);
                  if (target) {
                    router.push({
                      pathname: target.pathname as never,
                      params: target.params as never,
                    });
                  }
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: spacing.md,
                  paddingVertical: spacing.lg,
                  paddingHorizontal: spacing.lg,
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : unread ? theme.colors.surface : 'transparent',
                })}
              >
                <View
                  style={{
                    width: 36, height: 36, borderRadius: 18,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: unread ? theme.colors.primaryMuted : theme.colors.surfaceMuted,
                  }}
                >
                  <Ionicons
                    name={iconFor(item.type)}
                    size={18}
                    color={unread ? theme.colors.primary : theme.colors.textFaint}
                  />
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant={unread ? 'bodyStrong' : 'body'} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={3}>{item.body}</Text>
                  <Text variant="micro" tone="faint">{formatRelative(item.createdAt)}</Text>
                </View>

                {unread ? (
                  <View
                    accessibilityElementsHidden
                    style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: theme.colors.primary, marginTop: 6,
                    }}
                  />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  if (type.includes('quote')) return 'document-text-outline';
  if (type.includes('invoice') || type.includes('payment')) return 'card-outline';
  if (type.includes('job') || type.includes('lead')) return 'briefcase-outline';
  if (type.includes('review')) return 'star-outline';
  if (type.includes('subscription') || type.includes('billing')) return 'pricetag-outline';
  return 'notifications-outline';
}
