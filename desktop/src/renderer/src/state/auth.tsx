import React, { createContext, useContext, useState } from 'react';
import type { User } from '@hardweb-pos/shared';
import { api, setToken } from '../lib/api';

interface AuthState {
  user: User | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  token: string;
  user: User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  });

  async function login(loginName: string, password: string) {
    const res = await api.post<LoginResponse>('/auth/login', {
      login: loginName,
      password,
    });
    setToken(res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    localStorage.removeItem('user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth AuthProvider ichida ishlatilishi kerak');
  return ctx;
}
