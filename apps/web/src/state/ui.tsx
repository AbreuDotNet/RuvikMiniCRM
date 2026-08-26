import {
  createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode,
} from 'react';

/* --------------------------------------------------------------- toast --- */

export interface Toast {
  id: string;
  message: string;
  tone: 'default' | 'success' | 'error';
}

interface ToastContextValue {
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<ToastContextValue['notify']>((message, tone = 'default') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const value = useMemo(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* --------------------------------------------------------------- theme --- */

export type ThemeChoice = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = 'ruvik.theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      // Private browsing can throw on access; the system default is fine.
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    // 'system' removes the attribute so prefers-color-scheme decides.
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Preference is not persisted; the session still honours the choice.
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme: setThemeState }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
