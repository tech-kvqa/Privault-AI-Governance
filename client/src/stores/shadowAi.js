import { defineStore } from 'pinia';
import api from '../lib/api';

export const useShadowAiStore = defineStore('shadowAi', {
  state: () => ({
    events: [],
    policies: [],
    kpis: null,
    loading: false,
    logging: false,
    error: null,
    lastNote: null,
  }),
  actions: {
    async fetchEvents() {
      this.loading = true;
      try {
        const { data } = await api.get('/shadow-ai/events');
        this.events = data.events;
      } finally {
        this.loading = false;
      }
    },
    async fetchPolicies() {
      this.loading = true;
      try {
        const { data } = await api.get('/shadow-ai/policies');
        this.policies = data.policies;
      } finally {
        this.loading = false;
      }
    },
    async fetchKpis() {
      const { data } = await api.get('/shadow-ai/dashboard');
      this.kpis = data.kpis;
    },
    async createPolicy(payload) {
      const { data } = await api.post('/shadow-ai/policies', payload);
      return data.policy;
    },
    async updatePolicy(id, payload) {
      const { data } = await api.put(`/shadow-ai/policies/${id}`, payload);
      return data.policy;
    },
    async logEvent(fields, file) {
      this.logging = true;
      this.error = null;
      try {
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== '') form.append(k, v);
        });
        if (file) form.append('file', file);
        const { data } = await api.post('/shadow-ai/events', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        this.lastNote = data.note || null;
        return data;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
        throw e;
      } finally {
        this.logging = false;
      }
    },
  },
});
