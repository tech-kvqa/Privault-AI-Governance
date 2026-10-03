import { defineStore } from 'pinia';
import axios from 'axios';

// Public portal calls go through a bare axios instance — no auth token, no 401-redirect interceptor.
const publicApi = axios.create({ baseURL: (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4100') + '/public' });

export const usePortalStore = defineStore('portal', {
  state: () => ({ info: null, submitted: null, statusResult: null, error: '' }),
  actions: {
    async fetchInfo(slug) {
      this.error = '';
      try { this.info = (await publicApi.get(`/${slug}/info`)).data; }
      catch (e) { this.error = e.response?.status === 404 ? 'Organisation not found.' : 'Could not load this page.'; this.info = null; }
    },
    async submit(slug, payload) {
      const { data } = await publicApi.post(`/${slug}/requests`, payload);
      this.submitted = data;
      return data;
    },
    async checkStatus(slug, reference, token) {
      const { data } = await publicApi.post(`/${slug}/status`, { reference, token });
      this.statusResult = data;
      return data;
    },
  },
});
