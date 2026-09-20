import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { Text } from './Text';

type FeedbackTone = 'success' | 'error' | 'info';

interface FeedbackContextValue {
  notify: (message: string, tone?: FeedbackTone) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

interface Message {
  id: number;
  text: string;
  tone: FeedbackTone;
}

/**
 * Transient confirmation of something that already happened.
 *
 * Never used for something the person must act on — that belongs in a
 * `Banner` on the screen, where it stays put. A toast that carries the only
 * copy of an important message is a message you have thrown away.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, tone: FeedbackTone = 'info') => {
    counter.current += 1;
    setMessage({ id: counter.current, text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), tone === 'error' ? 6000 : 3500);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {message ? <Toast key={message.id} message={message} /> : null}
    </FeedbackContext.Provider>
  );
}

function Toast({ message }: { message: Message }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // A lazy `useState` initialiser rather than a ref: the value must be created
  // once and is read while rendering, which is exactly what a ref is not for.
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
  }, [enter]);

  const look = {
    success: { bg: theme.colors.successMuted, fg: theme.colors.success, icon: 'checkmark-circle' },
    error: { bg: theme.colors.dangerMuted, fg: theme.colors.danger, icon: 'alert-circle' },
    info: { bg: theme.colors.surface, fg: theme.colors.text, icon: 'information-circle' },
  }[message.tone] as { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap };

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        top: insets.top + spacing.sm,
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: look.bg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Ionicons name={look.icon} size={18} color={look.fg} />
        <Text variant="caption" style={{ color: look.fg, flex: 1 }}>{message.text}</Text>
      </View>
    </Animated.View>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}
