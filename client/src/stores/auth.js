import { defineStore } from 'pinia';
import api from '../lib/api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('privault_token') || null,
    user: JSON.parse(localStorage.getItem('privault_user') || 'null'),
    permissions: JSON.parse(localStorage.getItem('privault_permissions') || '[]'),
    sessionRestricted: localStorage.getItem('privault_restricted') === 'true',
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    role: (state) => state.user?.role || null,
    can: (state) => (perm) => state.permissions.includes('*') || state.permissions.includes(perm),
  },
  actions: {
    // Returns { done: true } on a completed sign-in, or { mfaRequired: true, mfaToken, needsTenant } to
    // continue the flow — the Login view drives the next step from this.
    async login(email, password, tenant) {
      const { data } = await api.post('/auth/login', { email, password, tenant: tenant || undefined });
      if (data.needsTenant) return { needsTenant: true };
      if (data.mfaRequired) return { mfaRequired: true, mfaToken: data.mfaToken };
      this._store(data.token, data.user);
      return { done: true, mfaSetupRequired: data.mfaSetupRequired };
    },
    async verifyMfa(mfaToken, { code, recoveryCode }) {
      const { data } = await api.post('/auth/mfa/verify', { mfaToken, code: code || undefined, recoveryCode: recoveryCode || undefined });
      this._store(data.token, data.user);
      return data;
    },
    _store(token, user) {
      this.token = token;
      this.user = user;
      localStorage.setItem('privault_token', token);
      localStorage.setItem('privault_user', JSON.stringify(user));
      this.refreshSession();
    },
    async refreshSession() {
      const { data } = await api.get('/auth/me');
      this.user = data.user;
      this.permissions = data.permissions;
      this.sessionRestricted = !!data.session.restricted;
      localStorage.setItem('privault_user', JSON.stringify(data.user));
      localStorage.setItem('privault_permissions', JSON.stringify(data.permissions));
      localStorage.setItem('privault_restricted', String(this.sessionRestricted));
      return data;
    },
    async logout() {
      try { await api.post('/auth/logout'); } catch { /* clear locally regardless */ }
      this.clear();
    },
    clear() {
      this.token = null;
      this.user = null;
      this.permissions = [];
      this.sessionRestricted = false;
      ['privault_token', 'privault_user', 'privault_permissions', 'privault_restricted'].forEach((k) => localStorage.removeItem(k));
    },
  },
});
