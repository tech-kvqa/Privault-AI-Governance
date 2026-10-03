import { defineStore } from 'pinia';
import api from '../lib/api';

export const useIntakeStore = defineStore('intake', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetch(status) {
      this.loading = true;
      try { const { data } = await api.get('/intake', { params: status ? { status } : {} }); this.items = data.intakes; }
      finally { this.loading = false; }
    },
    async verify(id, payload) { return (await api.post(`/intake/${id}/verify`, payload)).data; },
    async reject(id, reason) { return (await api.post(`/intake/${id}/reject`, { reason })).data; },
    async requestInfo(id, message) { return (await api.post(`/intake/${id}/request-info`, { message })).data; },
  },
});
