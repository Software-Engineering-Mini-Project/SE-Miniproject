'use client';

// Session state. DECISION (SAD §2): the SAD prefers an HttpOnly cookie; the SRS specifies a
// bearer JWT. Until the team decides, the token lives in memory and sessionStorage (cleared
// when the tab closes) and is sent as `Authorization: Bearer`. Swap storage here only.

import { create } from 'zustand';
import { api, configureApi } from './api/client.js';
import { clearQueryCache } from './hooks/useQuery.js';
import { useWorkspace } from './workspace.js';

const TOKEN_KEY = 'taskline.session';

function readStoredToken() {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw);
    return typeof token === 'string' && expiresAt > Date.now() ? token : null;
  } catch {
    return null;
  }
}

function writeStoredToken(token, expiresIn) {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + expiresIn * 1000 }));
    } else {
      window.sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Private mode or blocked storage: the session still works until refresh.
  }
}

/**
 * status: 'unknown' before the stored session is checked, then 'authenticated' or 'anonymous';
 * 'unavailable' when the stored session could not be checked (offline, server error). The token
 * is kept in that case, so `retryRestore()` can pick the session up again.
 * reason: why the session ended, shown on the sign-in screen ('expired' | 'signed-out').
 */
export const useSession = create((set, get) => ({
  status: 'unknown',
  token: null,
  user: null,
  reason: null,

  async restore() {
    if (get().status !== 'unknown') return;
    const token = readStoredToken();
    if (!token) {
      set({ status: 'anonymous' });
      return;
    }
    set({ token });
    try {
      const user = await api.auth.me();
      set({ user, status: 'authenticated' });
    } catch (error) {
      // Only a 401 means the token is bad. A network blip or a 5xx must not sign the user out.
      if (error?.status === 401) {
        writeStoredToken(null);
        set({ token: null, user: null, status: 'anonymous', reason: 'expired' });
      } else {
        set({ status: 'unavailable' });
      }
    }
  },

  retryRestore() {
    if (get().status !== 'unavailable') return Promise.resolve();
    set({ status: 'unknown', token: null });
    return get().restore();
  },

  /** Swaps in a fresh token (after a password change revoked the old one). */
  replaceToken(token, expiresIn) {
    writeStoredToken(token, expiresIn);
    set({ token });
  },

  async signIn(email, password) {
    const { token, expiresIn, user: loginUser } = await api.auth.login({ email, password });
    writeStoredToken(token, expiresIn);
    set({ token, reason: null });
    const user = loginUser ?? await api.auth.me();
    set({ user, status: 'authenticated' });
    return user;
  },

  setUser(user) {
    set({ user });
  },

  signOut(reason = 'signed-out') {
    writeStoredToken(null);
    clearQueryCache();
    // Drop the previous user's projects and unread count so the next account never sees them.
    useWorkspace.getState().clear();
    set({ token: null, user: null, status: 'anonymous', reason });
  },
}));

configureApi({
  getToken: () => useSession.getState().token,
  onUnauthorized: () => {
    if (useSession.getState().status === 'authenticated') useSession.getState().signOut('expired');
  },
});
