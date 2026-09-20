import { Platform } from 'react-native';

import type { Theme } from '../theme/tokens';

/**
 * Shared bottom-tab styling.
 *
 * One definition for all three roles so the bar does not subtly change height
 * or colour when an account switches, and so the label size respects the
 * device's text setting rather than being pinned.
 */
export function tabScreenOptions(theme: Theme) {
  return {
    headerShown: false,
    tabBarActiveTintColor: theme.colors.primary,
    tabBarInactiveTintColor: theme.colors.textFaint,
    tabBarStyle: {
      backgroundColor: theme.colors.surface,
      borderTopColor: theme.colors.border,
      borderTopWidth: 1,
      // Android tab bars sit lower and need a little more room to breathe.
      height: Platform.OS === 'ios' ? 84 : 64,
      paddingTop: 6,
    },
    tabBarLabelStyle: {
      fontSize: 11,
      fontWeight: '600' as const,
    },
    tabBarAllowFontScaling: true,
  };
}
