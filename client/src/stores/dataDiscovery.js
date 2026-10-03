import { defineStore } from 'pinia';
import api from '../lib/api';

export const useDataDiscoveryStore = defineStore('dataDiscovery', {
  state: () => ({
    assets: [],
    currentAsset: null,
    sampleValues: [],
    valuesMasked: true,
    mapNodes: [],
    mapEdges: [],
    findMeResult: null,
    loading: false,
    scanning: false,
    error: null,
  }),
  getters: {
    assetsForSystem: (state) => (aiSystemId) => state.assets.filter((a) => a.aiSystem?.id === aiSystemId),
  },
  actions: {
    async fetchAssets() {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get('/data-discovery/assets');
        this.assets = data.dataAssets;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async fetchAsset(id) {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get(`/data-discovery/assets/${id}`);
        this.currentAsset = data.dataAsset;
        this.sampleValues = data.sampleValues;
        this.valuesMasked = data.valuesMasked;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async scan(file, aiSystemId, relationship) {
      this.scanning = true;
      this.error = null;
      try {
        const form = new FormData();
        form.append('file', file);
        if (aiSystemId) form.append('aiSystemId', aiSystemId);
        if (relationship) form.append('relationship', relationship);
        const { data } = await api.post('/data-discovery/scan', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
        throw e;
      } finally {
        this.scanning = false;
      }
    },
    async fetchMap() {
      this.loading = true;
      try {
        const { data } = await api.get('/data-map');
        this.mapNodes = data.nodes;
        this.mapEdges = data.edges;
      } finally {
        this.loading = false;
      }
    },
    async findMeInAi(identifier) {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get('/find-me-in-ai', { params: { identifier } });
        this.findMeResult = data;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
        throw e;
      } finally {
        this.loading = false;
      }
    },
  },
});
