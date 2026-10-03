import { defineStore } from 'pinia';
import api from '../lib/api';

export const useAiSystemsStore = defineStore('aiSystems', {
  state: () => ({
    items: [],
    current: null,
    currentAuditTrail: [],
    kpis: null,
    loading: false,
    error: null,
  }),
  actions: {
    async fetchAll(params = {}) {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get('/ai-systems', { params });
        this.items = data.aiSystems;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async fetchOne(id) {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get(`/ai-systems/${id}`);
        this.current = data.aiSystem;
        this.currentAuditTrail = data.auditTrail;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async create(payload) {
      const { data } = await api.post('/ai-systems', payload);
      return data.aiSystem;
    },
    async update(id, payload) {
      const { data } = await api.put(`/ai-systems/${id}`, payload);
      return data.aiSystem;
    },
    async archive(id, reason) {
      const { data } = await api.post(`/ai-systems/${id}/archive`, { reason });
      return data.aiSystem;
    },
    async fetchKpis() {
      const { data } = await api.get('/dashboard/kpis');
      this.kpis = data.kpis;
    },
    async assessRisk(id) {
      const { data } = await api.post(`/ai-systems/${id}/assess-risk`);
      return data;
    },
    async productionGate(id) {
      const { data } = await api.get(`/ai-systems/${id}/production-gate`);
      return data;
    },
  },
});
