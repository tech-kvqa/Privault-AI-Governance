import { defineStore } from 'pinia';
import api from '../lib/api';

export const useRiskComplianceStore = defineStore('riskCompliance', {
  state: () => ({
    dpias: [],
    currentDpia: null,
    controls: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchDpias() {
      this.loading = true;
      try {
        const { data } = await api.get('/dpias');
        this.dpias = data.dpias;
      } finally {
        this.loading = false;
      }
    },
    async fetchDpia(id) {
      const { data } = await api.get(`/dpias/${id}`);
      this.currentDpia = data.dpia;
      return data.dpia;
    },
    async createDpia(aiSystemId) {
      const { data } = await api.post('/dpias', { aiSystemId });
      return data.dpia;
    },
    async submitDpia(id) {
      const { data } = await api.post(`/dpias/${id}/submit`);
      return data.dpia;
    },
    async decideDpia(id, approve) {
      const { data } = await api.post(`/dpias/${id}/decide`, { approve });
      return data.dpia;
    },
    async fetchControls(params = {}) {
      this.loading = true;
      try {
        const { data } = await api.get('/compliance', { params });
        this.controls = data.controls;
      } finally {
        this.loading = false;
      }
    },
    async createControl(payload) {
      const { data } = await api.post('/compliance', payload);
      return data.control;
    },
    async updateControl(id, payload) {
      const { data } = await api.put(`/compliance/${id}`, payload);
      return data.control;
    },
  },
});
