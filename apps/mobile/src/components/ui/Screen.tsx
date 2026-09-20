import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

/** 16pt side gutter everywhere, so nothing ever touches the screen edge. */
export const GUTTER = spacing.lg;

export function Screen({
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
          flex: 1,
          backgroundColor: theme.colors.canvas,
          paddingHorizontal: padded ? GUTTER : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The default page body: scrolls, pulls to refresh, and leaves room under the
 * last element so a tab bar or home indicator never covers it.
 */
export function ScreenScroll({
  children,
  refreshing,
  onRefresh,
  padded = true,
  contentStyle,
  keyboardAware = false,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  keyboardAware?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const scroll = (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.canvas }}
      contentContainerStyle={[
        {
          paddingHorizontal: padded ? GUTTER : 0,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.xxxl,
          gap: spacing.lg,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      refreshControl={
        onRefresh
          ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={theme.colors.textMuted}
              colors={[theme.colors.primary]}
              progressBackgroundColor={theme.colors.surface}
            />
          )
          : undefined
      }
    >
      {children}
    </ScrollView>
  );

  if (!keyboardAware) return scroll;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {scroll}
    </KeyboardAvoidingView>
  );
}

/** Vertical rhythm between blocks, so no screen re-decides the gap. */
export function Stack({
  children,
  gap = spacing.md,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Row({
  children,
  gap = spacing.sm,
  align = 'center',
  justify,
  wrap,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          flexWrap: wrap ? 'wrap' : 'nowrap',
          gap,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
