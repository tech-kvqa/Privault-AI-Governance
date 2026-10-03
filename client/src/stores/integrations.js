import { defineStore } from 'pinia';
import api from '../lib/api';

export const useVendorsStore = defineStore('vendors', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const { data } = await api.get('/vendors');
        this.items = data.vendors;
      } finally {
        this.loading = false;
      }
    },
    async create(payload) { return (await api.post('/vendors', payload)).data.vendor; },
    async update(id, payload) { return (await api.put(`/vendors/${id}`, payload)).data.vendor; },
  },
});

export const useEvidenceStore = defineStore('evidence', {
  state: () => ({ items: [], loading: false, uploading: false }),
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const { data } = await api.get('/evidence');
        this.items = data.evidence;
      } finally {
        this.loading = false;
      }
    },
    async upload(fields, file) {
      this.uploading = true;
      try {
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => { if (v) form.append(k, v); });
        form.append('file', file);
        const { data } = await api.post('/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        return data.evidence;
      } finally {
        this.uploading = false;
      }
    },
    async verify(id) { return (await api.post(`/evidence/${id}/verify`)).data; },
    async review(id, status, note) { return (await api.post(`/evidence/${id}/review`, { status, note })).data.evidence; },
    async download(item) {
      const res = await api.get(`/evidence/${item.id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
  },
});

export const useWebhooksStore = defineStore('webhooks', {
  state: () => ({ endpoints: [], deliveries: [], loading: false }),
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const { data } = await api.get('/webhooks');
        this.endpoints = data.endpoints;
      } finally {
        this.loading = false;
      }
    },
    async create(payload) { return (await api.post('/webhooks', payload)).data; },
    async update(id, payload) { return (await api.put(`/webhooks/${id}`, payload)).data.endpoint; },
    async test(id) { return (await api.post(`/webhooks/${id}/test`)).data.delivery; },
    async fetchDeliveries(id) {
      const { data } = await api.get(`/webhooks/${id}/deliveries`);
      this.deliveries = data.deliveries;
    },
  },
});
