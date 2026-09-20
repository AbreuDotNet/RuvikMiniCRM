import { useColorScheme } from 'react-native';

import { RequireSession } from '../../src/components/Guard';
import {
  Card, ListRow, ScreenScroll, Stack, Text,
 Badge } from '../../src/components/ui';
import { useThemePreference, type ThemePreference } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';

const OPTIONS: { value: ThemePreference; title: string; subtitle: string }[] = [
  { value: 'system', title: 'Match the system', subtitle: 'Follows your device setting' },
  { value: 'light', title: 'Light', subtitle: 'Always light' },
  { value: 'dark', title: 'Dark', subtitle: 'Always dark' },
];

export default function AppearanceRoute() {
  return (
    <RequireSession>
      <Appearance />
    </RequireSession>
  );
}

function Appearance() {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  const setPreference = useThemePreference((s) => s.setPreference);

  return (
    <ScreenScroll>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Appearance</Text>
        <Text variant="caption" tone="muted">
          Matching the system is the default, so Ruvik follows the rest of your phone.
        </Text>
      </Stack>

      <Card padded={false}>
        {OPTIONS.map((option) => (
          <ListRow
            key={option.value}
            title={option.title}
            subtitle={
              option.value === 'system'
                ? `${option.subtitle} — currently ${system ?? 'light'}`
                : option.subtitle
            }
            trailing={
              preference === option.value ? <Badge label="On" tone="primary" /> : undefined
            }
            onPress={() => setPreference(option.value)}
          />
        ))}
      </Card>
    </ScreenScroll>
  );
}
