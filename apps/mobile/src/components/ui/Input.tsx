import { useState } from 'react';
import {
  Pressable, TextInput, View,
  type TextInputProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { MIN_TOUCH, radius, spacing } from '../../theme/tokens';
import { Text } from './Text';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  style,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
          {required ? ' *' : ''}
        </Text>
      ) : null}
      {children}
      {/* The error replaces the hint rather than stacking with it: two lines of
          competing guidance under one input is how people miss the one that
          matters. */}
      {error ? (
        <Text variant="micro" tone="danger" accessibilityLiveRegion="polite">{error}</Text>
      ) : hint ? (
        <Text variant="micro" tone="faint">{hint}</Text>
      ) : null}
    </View>
  );
}

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Renders a show/hide control and starts obscured. */
  secure?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label, hint, error, required, leftIcon, secure, containerStyle, multiline, ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused ? theme.colors.primary : theme.colors.border;

  return (
    <Field label={label} hint={hint} error={error} required={required} style={containerStyle}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor,
          backgroundColor: theme.colors.surface,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          minHeight: multiline ? 108 : MIN_TOUCH + 4,
        }}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={18}
            color={theme.colors.textFaint}
            style={{ marginTop: multiline ? spacing.md : 0 }}
          />
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          allowFontScaling
          multiline={multiline}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={theme.colors.textFaint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: theme.colors.text,
            fontSize: 15,
            lineHeight: 21,
            paddingVertical: multiline ? spacing.md : spacing.sm,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
          {...rest}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={10}
            style={{ padding: spacing.xs }}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={theme.colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </Field>
  );
}

export interface SegmentOption<T extends string | undefined> {
  value: T;
  label: string;
}

/**
 * A horizontal choice. Built on plain Pressables with the radio role rather
 * than a picker, so VoiceOver and TalkBack announce the selected option.
 */
export function Segmented<T extends string | undefined>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  const theme = useTheme();

  return (
    <Field label={label}>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: radius.md,
          padding: 3,
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={{
                flex: 1,
                minHeight: 38,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: selected ? theme.colors.surface : 'transparent',
              }}
            >
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: selected ? theme.colors.text : theme.colors.textMuted }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/** A scrollable row of filter chips, for when there are more than three choices. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 38,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
      }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? theme.colors.primary : theme.colors.textMuted}
        />
      ) : null}
      <Text
        variant="caption"
        style={{ color: selected ? theme.colors.primary : theme.colors.textMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Switch({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: MIN_TOUCH + 8,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {description ? <Text variant="micro" tone="muted">{description}</Text> : null}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: radius.pill,
          padding: 3,
          backgroundColor: value ? theme.colors.primary : theme.colors.borderStrong,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#FFFFFF',
            marginLeft: value ? 20 : 0,
          }}
        />
      </View>
    </Pressable>
  );
}
