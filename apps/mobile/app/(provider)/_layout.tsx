import { Tabs } from 'expo-router/js-tabs';

import { RequireRole } from '../../src/components/Guard';
import { TabBarIcon } from '../../src/components/TabBarIcon';
import { tabScreenOptions } from '../../src/components/tabs';
import { useUnreadCount } from '../../src/features/notifications/hooks';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function ProviderLayout() {
  const theme = useTheme();
  const unread = useUnreadCount();

  return (
    <RequireRole role="provider">
      <Tabs screenOptions={tabScreenOptions(theme)}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color }) => <TabBarIcon name="speedometer-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            title: 'Jobs',
            tabBarIcon: ({ color }) => <TabBarIcon name="briefcase-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="clients"
          options={{
            title: 'Clients',
            tabBarIcon: ({ color }) => <TabBarIcon name="people-outline" color={color} />,
          }}
        />
        <Tabs.Screen
          name="money"
          options={{
            title: 'Money',
            tabBarIcon: ({ color }) => <TabBarIcon name="cash-outline" color={color} />,
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
