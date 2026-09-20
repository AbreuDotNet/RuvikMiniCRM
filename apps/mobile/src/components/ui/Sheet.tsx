import { useEffect, useState } from 'react';
import {
  Animated, Easing, Modal, Pressable, ScrollView, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

/**
 * A bottom sheet built on `Modal` and `Animated`.
 *
 * Not a library: the alternatives all pull in Reanimated and Gesture Handler,
 * which is a lot of native surface to add for a panel that slides up. This
 * uses the native driver, so it runs off the JS thread all the same.
 *
 * A sheet, not a centre modal, because the controls land under the thumb
 * rather than in the middle of the screen.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  /** Caps the body height; the content scrolls inside. */
  maxHeightRatio = 0.85,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxHeightRatio?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Created once, read during render — a lazy state initialiser, not a ref.
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      // Android's hardware back must close the sheet, not the screen behind it.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: theme.colors.scrim,
            opacity: slide,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ flex: 1 }}
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingBottom: insets.bottom + spacing.lg,
            transform: [{
              translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }),
            }],
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            <View
              style={{
                width: 40, height: 4, borderRadius: 2,
                backgroundColor: theme.colors.borderStrong,
              }}
            />
          </View>

          <View style={{ padding: spacing.lg, gap: 2 }}>
            <Text variant="heading" accessibilityRole="header">{title}</Text>
            {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
          </View>

          <ScrollView
            style={{ maxHeight: 600 * maxHeightRatio }}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Confirmation for something destructive or financial.
 *
 * The consequence is spelled out rather than implied, and the confirming
 * button carries the verb ("Void invoice"), never "OK" — people tap OK
 * reflexively and read the title afterwards.
 */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  tone = 'danger',
  busy = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  /** Extra input the confirmation needs, such as a reason. */
  children?: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Text variant="body" tone="muted">{message}</Text>
      {children}
      <Button
        label={confirmLabel}
        variant={tone === 'danger' ? 'danger' : 'primary'}
        loading={busy}
        haptic
        onPress={onConfirm}
      />
      <Button label="Cancel" variant="ghost" disabled={busy} onPress={onClose} />
    </Sheet>
  );
}
