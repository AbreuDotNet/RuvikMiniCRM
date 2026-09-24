import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api, setSessionLostHandler } from '../services/api';
import { unregisterDeviceToken } from '../services/push';
import type { AuthUser, MeResponse, Role, SessionResponse } from '../types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  role: 'customer' | 'provider';
  businessName?: string;
  city?: string;
  phone?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  /**
   * Auth level of *this session*, not of the account. `user.mfaEnabled` says
   * two-factor is configured; this says the challenge was satisfied on the
   * session in hand.
   */
  sessionAal: 'aal1' | 'mfa' | null;
  /** Whether this deployment demands a two-factor session for admin writes. */
  adminMfaRequired: boolean | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type LoginResponse =
  | { status: 'mfa_required'; mfaToken: string }
  | ({ status: 'ok' } & SessionResponse);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionAal, setSessionAal] = useState<'aal1' | 'mfa' | null>(null);
  const [adminMfaRequired, setAdminMfaRequired] = useState<boolean | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const clearSession = useCallback(() => {
    void api.clearSession();
    // Cached responses belong to the person who just left. Keeping them would
    // show the next account's sign-in screen somebody else's invoices for a
    // frame, which is a leak however brief.
    queryClient.clear();
    if (!mounted.current) return;
    setUser(null);
    setSessionAal(null);
    setAdminMfaRequired(null);
    setStatus('anonymous');
  }, [queryClient]);

  const adoptSession = useCallback(async (session: SessionResponse, aal: 'aal1' | 'mfa') => {
    await api.adoptSession(session);
    queryClient.clear();
    setUser(session.user);
    setSessionAal(aal);
    setStatus('authenticated');
  }, [queryClient]);

  /**
   * Cold start: the access token only ever lived in memory, so the keychain's
   * refresh token is what re-establishes the session silently.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = await api.refresh();
      if (cancelled) return;
      if (!token) {
        setStatus('anonymous');
        return;
      }
      try {
        const me = await api.get<MeResponse>('/auth/me');
        if (cancelled) return;
        setUser(me.user);
        setSessionAal(me.sessionAal ?? 'aal1');
        setAdminMfaRequired(me.adminMfaRequired ?? true);
        setStatus('authenticated');
      } catch {
        if (!cancelled) clearSession();
      }
    })();

    return () => { cancelled = true; };
  }, [clearSession]);

  useEffect(() => {
    setSessionLostHandler(clearSession);
    return () => setSessionLostHandler(null);
  }, [clearSession]);

  const login = useCallback<AuthContextValue['login']>(async (email, password) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    if (res.status === 'mfa_required') return { mfaRequired: true, mfaToken: res.mfaToken };
    await adoptSession(res, 'aal1');
    return { mfaRequired: false };
  }, [adoptSession]);

  const verifyMfa = useCallback<AuthContextValue['verifyMfa']>(async (mfaToken, code) => {
    const res = await api.post<{ status: 'ok' } & SessionResponse>(
      '/auth/mfa/verify', { mfaToken, code },
    );
    await adoptSession(res, 'mfa');
  }, [adoptSession]);

  const signup = useCallback<AuthContextValue['signup']>(async (input) => {
    const res = await api.post<SessionResponse>('/auth/signup', input);
    await adoptSession(res, 'aal1');
  }, [adoptSession]);

  const logout = useCallback(async () => {
    try {
      // Before the token is dropped, while the request can still authenticate:
      // afterwards there is no session to unregister with, and the handset
      // would keep ringing for work that is no longer this person's.
      await unregisterDeviceToken();
      // Sent with the refresh token so the server revokes that family too —
      // dropping it locally alone would leave a live 30-day credential.
      const refreshToken = await api.peekRefreshToken();
      await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } catch {
      // Signing out must succeed locally even when the network refuses.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<MeResponse>('/auth/me');
    if (!mounted.current) return;
    setUser(me.user);
    setSessionAal(me.sessionAal ?? 'aal1');
    setAdminMfaRequired(me.adminMfaRequired ?? true);
  }, []);

  const value = useMemo(
    () => ({
      user, status, sessionAal, adminMfaRequired,
      login, verifyMfa, signup, logout, refreshUser,
    }),
    [user, status, sessionAal, adminMfaRequired, login, verifyMfa, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user, for screens a guard has already protected. */
export function useCurrentUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser used outside an authenticated route');
  return user;
}

export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}
