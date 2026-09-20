import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../theme/tokens';
import { Text } from './ui';

/**
 * The title block on a tab screen.
 *
 * Tab screens hide the navigator header, so this carries the page name and
 * the top safe-area inset. It is a plain block rather than a sticky bar: the
 * title scrolls away and gives the content the whole screen, which on a phone
 * is the scarcer thing.
 */
export function PageHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.xs,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="display" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}
