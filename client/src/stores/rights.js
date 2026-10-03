import { defineStore } from 'pinia';
import api from '../lib/api';

export const useRightsStore = defineStore('rights', {
  state: () => ({
    consents: [],
    dsars: [],
    currentDsar: null,
    loading: false,
    error: null,
  }),
  actions: {
    async fetchConsents() {
      this.loading = true;
      try {
        const { data } = await api.get('/consents');
        this.consents = data.consents;
      } finally {
        this.loading = false;
      }
    },
    async createConsent(payload) {
      const { data } = await api.post('/consents', payload);
      return data.consent;
    },
    async withdrawConsent(id) {
      const { data } = await api.post(`/consents/${id}/withdraw`);
      return data;
    },
    async fetchDsars() {
      this.loading = true;
      try {
        const { data } = await api.get('/dsars');
        this.dsars = data.dsars;
      } finally {
        this.loading = false;
      }
    },
    async fetchDsar(id) {
      this.loading = true;
      try {
        const { data } = await api.get(`/dsars/${id}`);
        this.currentDsar = data.dsar;
      } finally {
        this.loading = false;
      }
    },
    async createDsar(payload) {
      const { data } = await api.post('/dsars', payload);
      return data.dsar;
    },
    async analyzeImpact(id) {
      const { data } = await api.post(`/dsars/${id}/analyze-impact`);
      return data;
    },
    async executeAction(dsarId, actionId) {
      const { data } = await api.post(`/dsars/${dsarId}/actions/${actionId}/execute`);
      return data;
    },
    async attestAction(dsarId, actionId, comments) {
      const { data } = await api.post(`/dsars/${dsarId}/actions/${actionId}/attest`, { comments });
      return data;
    },
    async closeDsar(id) {
      const { data } = await api.post(`/dsars/${id}/close`);
      return data;
    },
  },
});
