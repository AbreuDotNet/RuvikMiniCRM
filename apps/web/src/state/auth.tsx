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
  /**
   * Auth level of *this session*, not of the account. `mfaEnabled` says the
   * user has two-factor configured; this says they satisfied the challenge on
   * the session currently in hand. Admin screens gate destructive actions on
   * it so a reason is never typed into a form that is going to 403.
   * Null until /auth/me has answered.
   */
  sessionAal: 'aal1' | 'mfa' | null;
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

interface MeResponse {
  user: AuthUser;
  sessionAal?: 'aal1' | 'mfa';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [sessionAal, setSessionAal] = useState<'aal1' | 'mfa' | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setSessionAal(null);
    setStatus('anonymous');
  }, []);

  const adoptSession = useCallback((session: SessionResponse, aal: 'aal1' | 'mfa') => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setSessionAal(aal);
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
        const me = await api.get<MeResponse>('/auth/me');
        if (cancelled) return;
        setUser(me.user);
        setSessionAal(me.sessionAal ?? 'aal1');
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
    adoptSession(res, 'aal1');
    return { mfaRequired: false };
  }, [adoptSession]);

  const verifyMfa = useCallback<AuthContextValue['verifyMfa']>(async (mfaToken, code) => {
    const res = await api.post<{ status: 'ok' } & SessionResponse>('/auth/mfa/verify', { mfaToken, code });
    adoptSession(res, 'mfa');
  }, [adoptSession]);

  const signup = useCallback<AuthContextValue['signup']>(async (input) => {
    const res = await api.post<SessionResponse>('/auth/signup', input);
    adoptSession(res, 'aal1');
  }, [adoptSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<MeResponse>('/auth/me');
    setUser(me.user);
    setSessionAal(me.sessionAal ?? 'aal1');
  }, []);

  const value = useMemo(
    () => ({ user, status, sessionAal, login, verifyMfa, signup, logout, refreshUser }),
    [user, status, sessionAal, login, verifyMfa, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
