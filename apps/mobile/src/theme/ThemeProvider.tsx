import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

import { darkTheme, lightTheme, type Theme } from './tokens';

export type ThemePreference = 'light' | 'dark' | 'system';

const PREFERENCE_KEY = 'ruvik.theme-preference';

interface PreferenceState {
  preference: ThemePreference;
  hydrated: boolean;
  setPreference: (next: ThemePreference) => void;
  hydrate: () => Promise<void>;
}

/**
 * The one thing Zustand holds here is a genuine client preference. Server
 * data belongs to React Query; duplicating it into a store is how two sources
 * of truth start disagreeing.
 */
export const useThemePreference = create<PreferenceState>((set) => ({
  preference: 'system',
  hydrated: false,
  setPreference: (next) => {
    set({ preference: next });
    void SecureStore.setItemAsync(PREFERENCE_KEY, next).catch(() => {
      // A lost preference is a cosmetic failure; never let it crash boot.
    });
  },
  hydrate: async () => {
    try {
      const stored = await SecureStore.getItemAsync(PREFERENCE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        set({ preference: stored, hydrated: true });
        return;
      }
    } catch {
      // Ignore — fall through to the system default.
    }
    set({ hydrated: true });
  },
}));

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  const hydrate = useThemePreference((s) => s.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const mode = preference === 'system' ? (system ?? 'light') : preference;
  const theme = mode === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    // Keeps the window background behind the navigator in step, so a push
    // transition never flashes white on a dark device.
    void SystemUI.setBackgroundColorAsync(theme.colors.canvas).catch(() => {});
  }, [theme.colors.canvas]);

  const value = useMemo(() => theme, [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
