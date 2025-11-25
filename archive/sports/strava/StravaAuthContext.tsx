"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

export interface StravaUser {
  id: string;              // internal id (could be athlete id or generated)
  athleteId?: string;      // optional Strava athlete id
  name: string;            // display name
  accessToken: string;     // short-lived access token
  refreshToken?: string;   // refresh token (if implementing oauth refresh)
  expiresAt?: number;      // epoch seconds token expiry
}

interface StravaAuthContextValue {
  users: StravaUser[];
  currentUser: StravaUser | null;
  setCurrentUserId: (id: string) => void;
  addOrUpdateUser: (user: StravaUser) => void;
  updateUserToken: (id: string, tokenPatch: Partial<Pick<StravaUser, 'accessToken' | 'refreshToken' | 'expiresAt'>>) => void;
  removeUser: (id: string) => void;
  clearAll: () => void;
  refreshUserToken: (id: string) => Promise<boolean>;
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit & { userId?: string }) => Promise<Response>;
  isTokenExpired: (user: StravaUser) => boolean;
}

const StravaAuthContext = createContext<StravaAuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'strava_users_v1';
const CURRENT_KEY = 'strava_current_user_id';

export function StravaAuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<StravaUser[]>([]);
  const [currentUser, setCurrentUser] = useState<StravaUser | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: StravaUser[] = JSON.parse(raw);
        setUsers(parsed);
        const savedId = localStorage.getItem(CURRENT_KEY);
        if (savedId) {
          const found = parsed.find(u => u.id === savedId) || null;
          setCurrentUser(found);
        }
      }
    } catch (e) {
      console.warn('Failed to load stored Strava users', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    } catch (e) {
      console.warn('Failed to persist Strava users', e);
    }
  }, [users]);

  function setCurrentUserId(id: string) {
    localStorage.setItem(CURRENT_KEY, id);
    setCurrentUser(users.find(u => u.id === id) || null);
  }

  function addOrUpdateUser(user: StravaUser) {
    setUsers(prev => {
      const exists = prev.find(u => u.id === user.id);
      if (exists) {
        return prev.map(u => u.id === user.id ? { ...exists, ...user } : u);
      }
      return [...prev, user];
    });
    setCurrentUser(user);
    localStorage.setItem(CURRENT_KEY, user.id);
  }

  function removeUser(id: string) {
    setUsers(prev => prev.filter(u => u.id !== id));
    if (currentUser?.id === id) {
      setCurrentUser(null);
      localStorage.removeItem(CURRENT_KEY);
    }
  }

  function updateUserToken(id: string, tokenPatch: Partial<Pick<StravaUser, 'accessToken' | 'refreshToken' | 'expiresAt'>>) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...tokenPatch } : u));
    setCurrentUser(prev => prev && prev.id === id ? { ...prev, ...tokenPatch } : prev);
  }

  function clearAll() {
    setUsers([]);
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CURRENT_KEY);
  }

  const refreshUserToken = useCallback(async (id: string): Promise<boolean> => {
    const target = users.find(u => u.id === id);
    if (!target) return false;
    if (!target.refreshToken) return false; // nothing to refresh
    try {
      const res = await fetch('/api/strava/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: target.refreshToken })
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn('Refresh failed', data);
        return false;
      }
      updateUserToken(id, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at
      });
      return true;
    } catch (err) {
      console.warn('Token refresh error', err);
      return false;
    }
  }, [users]);

  // proactive refresh ~2 minutes before expiry when current user changes
  useEffect(() => {
    if (!currentUser) return;
    if (!currentUser.expiresAt) return;
    const msLeft = currentUser.expiresAt * 1000 - Date.now();
    const REFRESH_EARLY_MS = 2 * 60 * 1000; // 2 minutes
    if (msLeft <= 0) {
      refreshUserToken(currentUser.id);
      return;
    }
    const timer = setTimeout(() => {
      refreshUserToken(currentUser.id);
    }, Math.max(1000, msLeft - REFRESH_EARLY_MS));
    return () => clearTimeout(timer);
  }, [currentUser, refreshUserToken]);

  const authenticatedFetch: StravaAuthContextValue['authenticatedFetch'] = async (input, init = {}) => {
    const userId = init.userId || currentUser?.id;
    const target = users.find(u => u.id === userId);
    if (!target) throw new Error('No Strava user for authenticated fetch');
    if (isTokenExpired(target)) {
      await refreshUserToken(target.id);
    }
    const latest = users.find(u => u.id === target.id) || target;
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${latest.accessToken}`);
    return fetch(input, { ...init, headers });
  };

  function isTokenExpired(user: StravaUser): boolean {
    if (!user.expiresAt) return true;
    return Date.now() >= user.expiresAt * 1000;
  }

  const value: StravaAuthContextValue = {
    users,
    currentUser,
    setCurrentUserId,
    addOrUpdateUser,
    updateUserToken,
    removeUser,
    clearAll,
    refreshUserToken,
    isTokenExpired,
    authenticatedFetch,
  };

  return (
    <StravaAuthContext.Provider value={value}>
      {children}
    </StravaAuthContext.Provider>
  );
}

export function useStravaAuth() {
  const ctx = useContext(StravaAuthContext);
  if (!ctx) throw new Error('useStravaAuth must be used within StravaAuthProvider');
  return ctx;
}
