import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@hardweb-pos/shared';
import { api, getToken, setToken, SESSION_EXPIRED_EVENT } from '../lib/api';

interface AuthState {
  user: User | null;
  login: (login: string, password: string) => Promise<void>;
  loginByPin: (pin: string) => Promise<void>;
  logout: () => void;
  /** Joriy foydalanuvchini yangilash (masalan parol almashtirilgach) — localStorage'ga ham yoziladi */
  updateUser: (user: User) => void;
  /**
   * Joriy foydalanuvchini serverdan qayta o'qish (GET /auth/me): ruxsatlar va "parolni almashtirish"
   * talabi yangilanadi. 401 bo'lsa sessiya tugaydi (api.ts), tarmoq xatosida saqlangan sessiya qoladi.
   */
  refreshUser: () => Promise<void>;
  /** Sessiya muddati tugagani (yoki xodim bloklangani) uchun chiqarildimi — login ekranida bir martalik xabar */
  sessionExpired: boolean;
  /** Chiqarish sababi (masalan B35: "Direktor faqat kassa (server) kompyuteridan kira oladi"); bo'sh — oddiy muddat tugashi */
  sessionExpiredReason: string;
  dismissSessionExpired: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  token: string;
  user: User;
}

function isUser(v: unknown): v is User {
  const u = v as User | null;
  return !!u && typeof u === 'object' && typeof u.id === 'string' && !!u.id && typeof u.role === 'string';
}

function storeUser(u: User | null): void {
  try {
    if (u) localStorage.setItem('user', JSON.stringify(u));
    else localStorage.removeItem('user');
  } catch {
    /* localStorage yopiq — sessiya faqat xotirada */
  }
}

// Saqlangan sessiya: buzilgan JSON yoki tokensiz foydalanuvchi — tizimdan chiqqan hisoblanadi
// (aks holda ilova oq ekran bilan qulab tushardi yoki har so'rov 401 olardi).
function readStoredUser(): User | null {
  let user: User | null = null;
  try {
    const raw = localStorage.getItem('user');
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isUser(parsed)) user = parsed;
  } catch {
    user = null;
  }
  if (user && getToken()) return user;
  storeUser(null);
  setToken(null);
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(readStoredUser);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiredReason, setSessionExpiredReason] = useState('');
  // Hodisa/async callback'lar joriy foydalanuvchini ko'rishi uchun
  const userRef = useRef<User | null>(user);

  const setUser = useCallback((u: User | null) => {
    userRef.current = u;
    setUserState(u);
  }, []);

  // api.ts 401 olganda (token muddati tugagan, xodim bloklangan/o'chirilgan) — tizimdan chiqaramiz
  useEffect(() => {
    const onExpired = (e: Event) => {
      const reason = (e as CustomEvent<unknown>).detail;
      if (userRef.current) {
        setSessionExpired(true);
        setSessionExpiredReason(typeof reason === 'string' ? reason : '');
      }
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [setUser]);

  const startSession = useCallback(
    (res: LoginResponse) => {
      setToken(res.token);
      storeUser(res.user);
      setSessionExpired(false);
      setUser(res.user);
    },
    [setUser],
  );

  const login = useCallback(
    async (loginName: string, password: string) => {
      startSession(await api.post<LoginResponse>('/auth/login', { login: loginName, password }));
    },
    [startSession],
  );

  const loginByPin = useCallback(
    async (pin: string) => {
      startSession(await api.post<LoginResponse>('/auth/login-pin', { pin }));
    },
    [startSession],
  );

  const logout = useCallback(() => {
    setToken(null);
    storeUser(null);
    setSessionExpired(false);
    setUser(null);
  }, [setUser]);

  const updateUser = useCallback(
    (next: User) => {
      storeUser(next);
      setUser(next);
    },
    [setUser],
  );

  const refreshUser = useCallback(async () => {
    const tok = getToken();
    if (!tok || !userRef.current) return;
    try {
      const me = await api.get<User>('/auth/me');
      // Javob kelguncha chiqib ketilgan yoki boshqa xodim kirgan bo'lsa — eski javob qo'llanmaydi
      const current = userRef.current;
      if (getToken() !== tok || !current || !isUser(me) || me.id !== current.id) return;
      updateUser({ ...current, ...me });
    } catch {
      // 401 — api.ts sessiyani tugatdi; tarmoq xatosi — saqlangan sessiya bilan davom etamiz
    }
  }, [updateUser]);

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      login,
      loginByPin,
      logout,
      updateUser,
      refreshUser,
      sessionExpired,
      sessionExpiredReason,
      dismissSessionExpired,
    }),
    [user, login, loginByPin, logout, updateUser, refreshUser, sessionExpired, sessionExpiredReason, dismissSessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth AuthProvider ichida ishlatilishi kerak');
  return ctx;
}
