import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { brand, MIN_TOUCH, radius, spacing } from '../theme/tokens';
import { BrandMark } from './LaunchScreen';
import { Reveal, Text } from './ui';

/**
 * The frame every sign-in and sign-up screen sits in.
 *
 * A navy band carrying the mark, with the form on a sheet that overlaps it.
 * That shape is not decoration: it continues the launch screen the user was
 * just looking at, so signing in reads as the next step of starting the app
 * rather than a different product. The same rings appear, faintly.
 *
 * The sheet is inside the scroll view rather than pinned, so a long form on a
 * small phone scrolls the whole composition instead of trapping the fields
 * under the keyboard.
 */
export function AuthScaffold({
  title,
  subtitle,
  eyebrow,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** Small label above the title, e.g. a step counter. */
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
  /** Sits below the sheet's content, separated by a rule. */
  footer?: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: brand.navy }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.xxl }}>
          {/* The launch artwork, echoed at a whisper. Hidden from screen
              readers: it carries no information. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          >
            {/* Fainter than on the launch screen, and pushed up and right.
                At full strength the arc cut straight through the subtitle,
                and a decorative line that reads as a strikethrough is worse
                than no decoration at all. */}
            <View
              style={{
                position: 'absolute',
                width: width * 1.5,
                height: width * 1.5,
                borderRadius: width * 0.75,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.09)',
                top: -width * 1.12,
                left: -width * 0.1,
              }}
            />
            <View
              style={{
                position: 'absolute',
                width: width * 0.9,
                height: width * 0.9,
                borderRadius: width * 0.45,
                borderWidth: 1,
                borderColor: brand.accent,
                opacity: 0.22,
                top: -width * 0.58,
                left: width * 0.46,
                transform: [{ scaleY: 0.72 }, { rotate: '-14deg' }],
              }}
            />
          </View>

          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              hitSlop={8}
              style={{
                width: MIN_TOUCH,
                height: MIN_TOUCH,
                marginLeft: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="chevron-back" size={24} color={brand.onBrand} />
            </Pressable>
          ) : null}

          <View style={{ paddingHorizontal: spacing.xl, paddingTop: onBack ? spacing.xs : spacing.lg }}>
            <Reveal>
              <BrandMark size={52} />
            </Reveal>

            <Reveal delay={60}>
              {eyebrow ? <View style={{ marginTop: spacing.lg }}>{eyebrow}</View> : null}
              <Text
                variant="display"
                accessibilityRole="header"
                style={{ color: brand.onBrand, marginTop: eyebrow ? spacing.sm : spacing.lg }}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text variant="body" style={{ color: brand.onBrandMuted, marginTop: spacing.xs }}>
                  {subtitle}
                </Text>
              ) : null}
            </Reveal>
          </View>
        </View>

        <Reveal
          delay={120}
          distance={20}
          style={{
            flex: 1,
            backgroundColor: theme.colors.canvas,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
          }}
        >
          <View
            style={{
              flex: 1,
              padding: spacing.xl,
              paddingBottom: insets.bottom + spacing.xxl,
              gap: spacing.lg,
            }}
          >
            {children}

            {footer ? (
              <View style={{ marginTop: 'auto', gap: spacing.lg, paddingTop: spacing.xl }}>
                <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                {footer}
              </View>
            ) : null}
          </View>
        </Reveal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The step dots used by the multi-step sign-up. */
export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step + 1 }}
      style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}
    >
      {Array.from({ length: total }).map((_, index) => (
        <View
          key={index}
          style={{
            height: 4,
            width: index === step ? 28 : 16,
            borderRadius: radius.pill,
            backgroundColor: index <= step ? brand.accent : 'rgba(255,255,255,0.28)',
          }}
        />
      ))}
    </View>
  );
}
