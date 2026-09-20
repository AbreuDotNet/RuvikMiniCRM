import { RequireSession } from '../src/components/Guard';
import { NotificationsList } from '../src/features/notifications/NotificationsList';

/** The same list, reached from a stack push rather than a tab. */
export default function NotificationsRoute() {
  return (
    <RequireSession>
      <NotificationsList showHeader={false} />
    </RequireSession>
  );
}
