import { Tabs } from 'expo-router/js-tabs';

import { RequireRole } from '../../src/components/Guard';
import { TabBarIcon } from '../../src/components/TabBarIcon';
import { tabScreenOptions } from '../../src/components/tabs';
import { useUnreadCount } from '../../src/features/notifications/hooks';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function CustomerLayout() {
  const theme = useTheme();
  const unread = useUnreadCount();

  return (
    <RequireRole role="customer">
      <Tabs screenOptions={tabScreenOptions(theme)}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <TabBarIcon name="home-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Search',
            tabBarIcon: ({ color }) => <TabBarIcon name="search-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="requests"
          options={{
            title: 'Requests',
            tabBarIcon: ({ color }) => <TabBarIcon name="document-text-outline" color={color} />,
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
