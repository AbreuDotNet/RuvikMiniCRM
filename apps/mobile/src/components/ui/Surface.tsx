import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { MIN_TOUCH, radius, spacing } from '../../theme/tokens';
import type { Tone } from '../../utils/status';
import { Text } from './Text';

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: padded ? spacing.lg : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: inset }} />
  );
}

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: theme.colors.surfaceMuted, fg: theme.colors.textMuted },
    primary: { bg: theme.colors.primaryMuted, fg: theme.colors.primary },
    success: { bg: theme.colors.successMuted, fg: theme.colors.success },
    warning: { bg: theme.colors.warningMuted, fg: theme.colors.warning },
    danger: { bg: theme.colors.dangerMuted, fg: theme.colors.danger },
    info: { bg: theme.colors.infoMuted, fg: theme.colors.info },
  };
  const colors = map[tone];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        backgroundColor: colors.bg,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radius.pill,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={colors.fg} /> : null}
      <Text variant="micro" style={{ color: colors.fg }} uppercase>
        {label}
      </Text>
    </View>
  );
}

/**
 * A banner that says something and, where there is something to do about it,
 * offers it. A warning with no action is just an interruption.
 */
export function Banner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  const map: Record<Tone, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
    neutral: { bg: theme.colors.surfaceMuted, fg: theme.colors.textMuted, icon: 'information-circle-outline' },
    primary: { bg: theme.colors.primaryMuted, fg: theme.colors.primary, icon: 'information-circle-outline' },
    success: { bg: theme.colors.successMuted, fg: theme.colors.success, icon: 'checkmark-circle-outline' },
    warning: { bg: theme.colors.warningMuted, fg: theme.colors.warning, icon: 'alert-circle-outline' },
    danger: { bg: theme.colors.dangerMuted, fg: theme.colors.danger, icon: 'warning-outline' },
    info: { bg: theme.colors.infoMuted, fg: theme.colors.info, icon: 'information-circle-outline' },
  };
  const colors = map[tone];

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        backgroundColor: colors.bg,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Ionicons name={colors.icon} size={20} color={colors.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <Text variant="bodyStrong" style={{ color: colors.fg }}>{title}</Text> : null}
        <Text variant="caption" style={{ color: colors.fg }}>{message}</Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            hitSlop={8}
            style={{ marginTop: spacing.xs, minHeight: 28, justifyContent: 'center' }}
          >
            <Text variant="caption" style={{ color: colors.fg, textDecorationLine: 'underline' }}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.primaryMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="caption" style={{ color: theme.colors.primary }}>{initials}</Text>
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Extra context announced after the title, e.g. a status. */
  accessibilityHint?: string;
  disabled?: boolean;
}

export function ListRow({
  title, subtitle, meta, leading, trailing, onPress, accessibilityHint, disabled,
}: ListRowProps) {
  const theme = useTheme();

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        minHeight: MIN_TOUCH + spacing.md,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>{subtitle}</Text>
        ) : null}
        {meta ? <Text variant="micro" tone="faint">{meta}</Text> : null}
      </View>
      {trailing}
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}

/** A labelled number that opens the list behind it. A metric you cannot open is trivia. */
export function StatTile({
  label,
  value,
  caption,
  tone = 'neutral',
  onPress,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const accent = {
    neutral: theme.colors.text,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    info: theme.colors.info,
  }[tone];

  const body = (
    <View style={{ gap: 2 }}>
      <Text variant="micro" tone="muted" uppercase>{label}</Text>
      <Text variant="title" style={{ color: accent }}>{value}</Text>
      {caption ? <Text variant="micro" tone="faint">{caption}</Text> : null}
    </View>
  );

  const frame: ViewStyle = {
    flex: 1,
    minWidth: 140,
    backgroundColor: theme.colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: spacing.lg,
    minHeight: 92,
    justifyContent: 'center',
  };

  if (!onPress) return <View style={frame}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint="Opens the matching list"
      onPress={onPress}
      style={({ pressed }) => [frame, { opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>{body}</View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textFaint} />
      </View>
    </Pressable>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        minHeight: 32,
      }}
    >
      <Text variant="micro" tone="muted" uppercase>{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={10}>
          <Text variant="caption" tone="primary">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Label / value pair, the backbone of every detail screen. */
export function DetailRow({
  label,
  value,
  tone = 'default',
  strong = false,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'danger' | 'success';
  strong?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: spacing.lg,
        paddingVertical: 5,
      }}
    >
      <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>{label}</Text>
      <Text
        variant={strong ? 'bodyStrong' : 'caption'}
        tone={tone === 'default' ? 'default' : tone}
        style={{ flexShrink: 1, textAlign: 'right' }}
      >
        {value}
      </Text>
    </View>
  );
}
