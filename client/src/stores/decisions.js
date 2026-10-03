import { defineStore } from 'pinia';
import api from '../lib/api';

export const useDecisionsStore = defineStore('decisions', {
  state: () => ({
    decisions: [],
    appeals: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchDecisions(params = {}) {
      this.loading = true;
      try {
        const { data } = await api.get('/decisions', { params });
        this.decisions = data.decisions;
      } finally {
        this.loading = false;
      }
    },
    async createDecision(payload) {
      const { data } = await api.post('/decisions', payload);
      return data.decision;
    },
    async review(id, action, payload = {}) {
      const { data } = await api.post(`/decisions/${id}/${action}`, payload);
      return data.decision;
    },
    async fetchAppeals() {
      this.loading = true;
      try {
        const { data } = await api.get('/appeals');
        this.appeals = data.appeals;
      } finally {
        this.loading = false;
      }
    },
    async createAppeal(payload) {
      const { data } = await api.post('/appeals', payload);
      return data.appeal;
    },
    async investigateAppeal(id) {
      const { data } = await api.post(`/appeals/${id}/investigate`);
      return data.appeal;
    },
    async decideAppeal(id, outcome) {
      const { data } = await api.post(`/appeals/${id}/decide`, { outcome });
      return data.appeal;
    },
  },
});
