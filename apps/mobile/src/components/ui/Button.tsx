import {
  ActivityIndicator, Pressable, View,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../../theme/ThemeProvider';
import { MIN_TOUCH, radius, spacing } from '../../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** A short buzz on press. Off by default; reserved for committing actions. */
  haptic?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = true,
  disabled,
  style,
  haptic = false,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = Boolean(disabled) || loading;

  const height = size === 'sm' ? MIN_TOUCH : size === 'lg' ? 54 : 48;
  const paddingHorizontal = size === 'sm' ? spacing.md : spacing.lg;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: 'transparent' },
    secondary: { bg: theme.colors.surface, fg: theme.colors.text, border: theme.colors.borderStrong },
    ghost: { bg: 'transparent', fg: theme.colors.primary, border: 'transparent' },
    danger: { bg: theme.colors.danger, fg: '#FFFFFF', border: 'transparent' },
  };
  const tone = palette[variant];

  /**
   * A disabled filled button loses its fill entirely rather than fading.
   * Lowering opacity alone still reads as "pressable, just quiet", and people
   * tap it repeatedly waiting for something to happen.
   */
  const backgroundColor = isDisabled
    ? (variant === 'primary' || variant === 'danger' ? theme.colors.surfaceMuted : tone.bg)
    : tone.bg;
  const foreground = isDisabled ? theme.colors.textFaint : tone.fg;
  const borderColor = isDisabled ? theme.colors.border : tone.border;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={(event) => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(event);
      }}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal,
          borderRadius: radius.md,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: pressed && !isDisabled ? 0.85 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.99 : 1 }],
        },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color={foreground} /> : null}
      {!loading && icon && iconPosition === 'left' ? (
        <Ionicons name={icon} size={18} color={foreground} />
      ) : null}
      <Text
        variant={size === 'sm' ? 'caption' : 'bodyStrong'}
        style={{ color: foreground }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {!loading && icon && iconPosition === 'right' ? (
        <Ionicons name={icon} size={18} color={foreground} />
      ) : null}
    </Pressable>
  );
}

/** A square icon-only control, still 44pt so it is actually hittable. */
export function IconButton({
  icon,
  label,
  onPress,
  tone,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** Required: an icon with no accessible name is invisible to a screen reader. */
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const color = disabled
    ? theme.colors.textFaint
    : tone === 'danger' ? theme.colors.danger
      : tone === 'primary' ? theme.colors.primary
        : theme.colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
      })}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

/** The primary action pinned above the keyboard / home indicator. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        padding: spacing.lg,
        paddingBottom: spacing.lg,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        gap: spacing.sm,
      }}
    >
      {children}
    </View>
  );
}
