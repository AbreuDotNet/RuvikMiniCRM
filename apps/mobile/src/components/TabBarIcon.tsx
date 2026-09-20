import { View, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './ui';

/**
 * A tab icon, optionally carrying an unread count.
 *
 * The badge is capped at 9+ because a three-digit number in a tab bar is
 * noise: past a handful, the exact figure changes nothing about what you do.
 */
export function TabBarIcon({
  name,
  color,
  badge,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
  badge?: number;
}) {
  const theme = useTheme();
  const show = typeof badge === 'number' && badge > 0;

  return (
    <View>
      <Ionicons name={name} size={24} color={color} />
      {show ? (
        <View
          accessible={false}
          style={{
            position: 'absolute',
            top: -4,
            right: -8,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="micro" style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 13 }}>
            {badge > 9 ? '9+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
