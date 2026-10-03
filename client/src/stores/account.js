import { defineStore } from 'pinia';
import api from '../lib/api';

export const useAccountStore = defineStore('account', {
  state: () => ({ sessions: [], users: [], policy: null }),
  actions: {
    async fetchSessions() { const { data } = await api.get('/auth/sessions'); this.sessions = data.sessions; },
    async revokeSession(id) { await api.delete(`/auth/sessions/${id}`); },
    async logoutAll() { return (await api.post('/auth/logout-all')).data; },
    async changePassword(currentPassword, newPassword) { return (await api.post('/auth/change-password', { currentPassword, newPassword })).data; },
    async mfaSetup() { return (await api.post('/auth/mfa/setup')).data; },
    async mfaEnable(code) { return (await api.post('/auth/mfa/enable', { code })).data; },
    async mfaDisable(password, code) { return (await api.post('/auth/mfa/disable', { password, code })).data; },
    async mfaRegenerateRecoveryCodes(password, code) { return (await api.post('/auth/mfa/recovery-codes', { password, code })).data; },

    async fetchUsers() { const { data } = await api.get('/users'); this.users = data.users; },
    async inviteUser(payload) { return (await api.post('/users', payload)).data; },
    async updateUser(id, payload) { return (await api.put(`/users/${id}`, payload)).data.user; },
    async resetUserPassword(id) { return (await api.post(`/users/${id}/reset-password`)).data; },
    async revokeUserSessions(id) { return (await api.post(`/users/${id}/revoke-sessions`)).data; },
    async resetUserMfa(id) { return (await api.post(`/users/${id}/reset-mfa`)).data; },
    async fetchPolicy() { const { data } = await api.get('/users/policy'); this.policy = data; return data; },
    async updatePolicy(requireMfa) { const { data } = await api.put('/users/policy', { requireMfa }); await this.fetchPolicy(); return data; },
  },
});
