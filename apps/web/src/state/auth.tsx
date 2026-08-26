import {
  createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode,
} from 'react';
import { api, setAccessToken, setUnauthorizedHandler, refreshSession } from '../lib/api';

export type Role = 'admin' | 'provider' | 'customer';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  mfaEnabled: boolean;
  whatsappOptIn: boolean;
  providerId?: string | null;
  providerStatus?: string | null;
  subscriptionStatus?: string | null;
}

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  role: 'customer' | 'provider';
  businessName?: string;
  city?: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const adoptSession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  /**
   * On boot the access token is gone (it only ever lived in memory), so the
   * refresh cookie is used to re-establish the session silently.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await refreshSession();
        if (cancelled) return;
        if (!token) {
          clearSession();
          return;
        }
        const me = await api.get<{ user: AuthUser }>('/auth/me');
        if (cancelled) return;
        setUser(me.user);
        setStatus('authenticated');
      } catch {
        if (!cancelled) clearSession();
      }
    })();

    return () => { cancelled = true; };
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
  }, [clearSession]);

  const login = useCallback<AuthContextValue['login']>(async (email, password) => {
    const res = await api.post<
      { status: 'mfa_required'; mfaToken: string } | ({ status: 'ok' } & SessionResponse)
    >('/auth/login', { email, password });

    if (res.status === 'mfa_required') {
      return { mfaRequired: true, mfaToken: res.mfaToken };
    }
    adoptSession(res);
    return { mfaRequired: false };
  }, [adoptSession]);

  const verifyMfa = useCallback<AuthContextValue['verifyMfa']>(async (mfaToken, code) => {
    const res = await api.post<{ status: 'ok' } & SessionResponse>('/auth/mfa/verify', { mfaToken, code });
    adoptSession(res);
  }, [adoptSession]);

  const signup = useCallback<AuthContextValue['signup']>(async (input) => {
    const res = await api.post<SessionResponse>('/auth/signup', input);
    adoptSession(res);
  }, [adoptSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<{ user: AuthUser }>('/auth/me');
    setUser(me.user);
  }, []);

  const value = useMemo(
    () => ({ user, status, login, verifyMfa, signup, logout, refreshUser }),
    [user, status, login, verifyMfa, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
