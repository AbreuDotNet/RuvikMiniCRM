import { Tabs } from 'expo-router/js-tabs';

import { RequireRole } from '../../src/components/Guard';
import { TabBarIcon } from '../../src/components/TabBarIcon';
import { tabScreenOptions } from '../../src/components/tabs';
import { useUnreadCount } from '../../src/features/notifications/hooks';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The admin surface on mobile is deliberately small.
 *
 * Provider moderation, audit logs and bulk management stay on the web panel.
 * Those actions need a reason, a two-factor session and a screen wide enough
 * to read the history you are acting on — a reduced version on a phone would
 * mostly be a way to make an irreversible decision with less context.
 */
export default function AdminLayout() {
  const theme = useTheme();
  const unread = useUnreadCount();

  return (
    <RequireRole role="admin">
      <Tabs screenOptions={tabScreenOptions(theme)}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Overview',
            tabBarIcon: ({ color }) => <TabBarIcon name="grid-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: 'Alerts',
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="notifications-outline" color={color} badge={unread.data} />
            ),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: 'Account',
            tabBarIcon: ({ color }) => <TabBarIcon name="person-outline" color={color} />,
          }}
        />
      </Tabs>
    </RequireRole>
  );
}
