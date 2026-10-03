import { defineStore } from 'pinia';
import api from '../lib/api';

export const useConnectorsStore = defineStore('connectors', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const { data } = await api.get('/connectors');
        this.items = data.connectors;
      } finally {
        this.loading = false;
      }
    },
    async create(payload) { return (await api.post('/connectors', payload)).data; },
    async test(id) { return (await api.post(`/connectors/${id}/test`)).data; },
    async scan(id, payload) { return (await api.post(`/connectors/${id}/scan`, payload)).data; },
    async rotate(id, password) { return (await api.put(`/connectors/${id}/credentials`, { password })).data; },
  },
});
