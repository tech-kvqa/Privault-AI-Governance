import { defineStore } from 'pinia';
import api from '../lib/api';

export const useOperationsStore = defineStore('operations', {
  state: () => ({
    incidents: [],
    emergencyActions: [],
    monitoring: null,
    dpdp: null,
    governance: null,
    loading: false,
    error: null,
  }),
  actions: {
    async fetchIncidents() {
      this.loading = true;
      try {
        const { data } = await api.get('/incidents');
        this.incidents = data.incidents;
      } finally {
        this.loading = false;
      }
    },
    async createIncident(payload) {
      const { data } = await api.post('/incidents', payload);
      return data.incident;
    },
    async advanceIncident(id, evidence) {
      const { data } = await api.post(`/incidents/${id}/advance`, { evidence });
      return data.incident;
    },
    async recordBreachNotification(id, payload) {
      const { data } = await api.post(`/incidents/${id}/breach-notification`, payload);
      return data.incident;
    },
    async approveEmergencyAction(id, note) {
      const { data } = await api.post(`/emergency/actions/${id}/approve`, { note });
      return data;
    },
    async rejectEmergencyAction(id, note) {
      const { data } = await api.post(`/emergency/actions/${id}/reject`, { note });
      return data;
    },
    async fetchEmergencyActions() {
      const { data } = await api.get('/emergency/actions');
      this.emergencyActions = data.actions;
    },
    async executeEmergencyAction(aiSystemId, payload) {
      const { data } = await api.post(`/emergency/ai-systems/${aiSystemId}/actions`, payload);
      return data;
    },
    async fetchMonitoring() {
      const { data } = await api.get('/monitoring');
      this.monitoring = data.monitoring;
      this.dpdp = data.dpdp;
      this.governance = data.governance;
    },
  },
});
