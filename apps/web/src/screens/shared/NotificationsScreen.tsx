import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS, PROVIDER_TABS, ADMIN_TABS } from '../../components/nav';
import { Icon, type IconName } from '../../components/Icon';
import {
  Button, SkeletonList, ErrorState, EmptyState, LoadMore, RefreshBar,
} from '../../components/ui';
import { usePagedApi, type PagedResponse } from '../../lib/useApi';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { formatRelative } from '../../lib/format';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Maps a notification type to its glyph and the screen it should open. */
function iconFor(type: string): IconName {
  if (type.startsWith('quote')) return 'file-text';
  if (type.startsWith('invoice')) return 'receipt';
  if (type.startsWith('lead')) return 'sparkle';
  if (type.startsWith('review')) return 'star';
  if (type.startsWith('subscription')) return 'shield';
  if (type.startsWith('account') || type.startsWith('provider')) return 'user';
  return 'bell';
}

function destinationFor(notification: NotificationRow, role: string): string | null {
  const data = notification.data as Record<string, string | undefined>;
  if (data.quoteId) return `/quotes/${data.quoteId}`;
  if (data.invoiceId) return `/invoices/${data.invoiceId}`;
  if (data.jobId) return role === 'provider' ? `/jobs/${data.jobId}` : `/requests/${data.jobId}`;
  if (data.subscriptionId) return '/subscription';
  return null;
}

const PAGE_SIZE = 50;

/** The list endpoint also reports the unread badge count. */
interface NotificationList extends PagedResponse<NotificationRow> {
  unreadCount: number;
}

export function NotificationsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const notifications = usePagedApi<NotificationRow, NotificationList>(
    (cursor) => api.get('/notifications', { cursor: cursor ?? undefined, limit: PAGE_SIZE }),
    [],
  );

  const tabs = user?.role === 'provider' ? PROVIDER_TABS
    : user?.role === 'admin' ? ADMIN_TABS : CUSTOMER_TABS;

  const open = async (notification: NotificationRow) => {
    if (!notification.readAt) {
      await api.post(`/notifications/${notification.id}/read`, {}).catch(() => undefined);
    }
    const destination = destinationFor(notification, user?.role ?? 'customer');
    if (destination) navigate(destination);
    else notifications.reload();
  };

  const markAll = async () => {
    await api.post('/notifications/read-all', {}).catch(() => undefined);
    notifications.reload();
  };

  const unread = notifications.response?.unreadCount ?? 0;

  return (
    <Shell
      title="Notifications"
      tabs={tabs}
      action={
        unread > 0 ? (
          <button
            type="button"
            className="app-header__action"
            onClick={markAll}
            aria-label="Mark all as read"
            style={{ width: 'auto', padding: '0 10px', fontSize: '0.78rem', fontWeight: 650 }}
          >
            Read all
          </button>
        ) : undefined
      }
    >
      {notifications.loading ? (
        <SkeletonList rows={5} />
      ) : notifications.error ? (
        <ErrorState message={notifications.error} onRetry={notifications.reload} />
      ) : !notifications.items.length ? (
        <EmptyState
          icon="bell"
          title="No notifications"
          body="Updates about your quotes, jobs and invoices will appear here."
        />
      ) : (
        <div className="list-group">
          <RefreshBar active={notifications.refreshing} />
          {notifications.items.map((notification) => (
            <button
              key={notification.id}
              type="button"
              className="list-item"
              onClick={() => open(notification)}
              style={{
                alignItems: 'flex-start',
                background: notification.readAt ? undefined : 'var(--brand-soft)',
              }}
            >
              <div
                className="avatar avatar--sm"
                style={{
                  background: notification.readAt ? 'var(--bg-inset)' : 'var(--brand)',
                  color: notification.readAt ? 'var(--text-subtle)' : '#fff',
                }}
              >
                <Icon name={iconFor(notification.type)} size={16} />
              </div>
              <div className="grow">
                <div className="list-item__title">{notification.title}</div>
                <div className="list-item__meta">{notification.body}</div>
                <div className="tiny subtle" style={{ marginTop: 4 }}>
                  {formatRelative(notification.createdAt)}
                </div>
              </div>
              {!notification.readAt && (
                <span
                  aria-label="Unread"
                  style={{
                    width: 9, height: 9, borderRadius: 999,
                    background: 'var(--accent)', flexShrink: 0, marginTop: 6,
                  }}
                />
              )}
            </button>
          ))}

          <LoadMore
            hasMore={notifications.hasMore}
            loading={notifications.loadingMore}
            error={notifications.moreError}
            onLoadMore={notifications.loadMore}
            count={notifications.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      {unread > 0 && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <Button variant="secondary" block onClick={markAll}>Mark all as read</Button>
        </div>
      )}
    </Shell>
  );
}
