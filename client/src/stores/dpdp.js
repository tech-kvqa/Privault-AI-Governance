import { defineStore } from 'pinia';
import api from '../lib/api';

export const useDpdpStore = defineStore('dpdp', {
  state: () => ({ settings: null, sdfChecklist: [], nominees: [], loading: false }),
  actions: {
    async fetchSettings() {
      this.loading = true;
      try {
        const { data } = await api.get('/settings/dpdp');
        this.settings = data.settings;
        this.sdfChecklist = data.sdfChecklist;
      } finally {
        this.loading = false;
      }
    },
    async saveSettings(payload) {
      const { data } = await api.put('/settings/dpdp', payload);
      this.settings = { ...this.settings, ...data.settings };
      await this.fetchSettings();
    },
    async fetchNominees() {
      const { data } = await api.get('/nominees');
      this.nominees = data.nominees;
    },
    async registerNominee(payload) {
      const { data } = await api.post('/nominees', payload);
      return data.nominee;
    },
  },
});
