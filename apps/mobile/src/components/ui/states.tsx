import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { ApiError } from '../../services/apiClient';
import { Button } from './Button';
import { Card } from './Surface';
import { Text } from './Text';

/**
 * Fades and lifts its children in on mount.
 *
 * Used to stagger a screen's blocks by a few dozen milliseconds each, so the
 * page assembles rather than appearing all at once. Kept small deliberately:
 * a 12pt rise over 380ms reads as the screen settling, while anything longer
 * is an animation the user waits through on every visit.
 *
 * Runs on the native driver, so it costs nothing on the JS thread.
 */
export function Reveal({
  children,
  delay = 0,
  distance = 12,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 380,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [distance, 0],
            }),
          }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A pulsing placeholder the same shape as the thing that is loading. */
export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // Created once, read during render — a lazy state initialiser, not a ref.
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius.sm, backgroundColor: theme.colors.skeleton, opacity: pulse },
        style,
      ]}
    />
  );
}

/**
 * Card-shaped skeletons.
 *
 * Deliberately the shape of the content rather than a spinner: a list that
 * resolves into the same silhouette does not jump, and the screen reads as
 * loading rather than broken.
 */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ gap: spacing.md }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index}>
          <View style={{ gap: spacing.sm }}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="85%" height={13} />
            <Skeleton width="40%" height={13} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text variant="caption" tone="muted">{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md }}>
      <View
        style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: theme.colors.surfaceMuted,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={28} color={theme.colors.textFaint} />
      </View>
      <Text variant="heading" align="center">{title}</Text>
      <Text variant="caption" tone="muted" align="center" style={{ maxWidth: 300 }}>
        {message}
      </Text>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          fullWidth={false}
          variant="secondary"
          // The block is centred, so the button has to be told to centre too:
          // `fullWidth={false}` aligns to the start, which left it hugging the
          // left edge under centred text.
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </View>
  );
}

/**
 * An error the reader can act on.
 *
 * The API's message is shown verbatim — it is written for humans and is more
 * specific than anything this component could invent. Retry only appears when
 * retrying could plausibly help; offering it after a 403 is a lie.
 */
export function ErrorState({
  error,
  onRetry,
  title = 'That did not load',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const theme = useTheme();
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError?.message
    ?? (error instanceof Error ? error.message : 'Something went wrong.');
  const retryable = apiError ? apiError.isTransient : true;

  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md }}>
      <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textFaint} />
      <Text variant="heading" align="center">{title}</Text>
      <Text variant="caption" tone="muted" align="center" style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {apiError?.requestId ? (
        <Text variant="micro" tone="faint" selectable>
          Reference {apiError.requestId}
        </Text>
      ) : null}
      {onRetry && retryable ? (
        <Button
          label="Try again"
          onPress={onRetry}
          fullWidth={false}
          variant="secondary"
          icon="refresh"
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </View>
  );
}
