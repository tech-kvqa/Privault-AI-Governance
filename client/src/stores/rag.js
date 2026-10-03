import { defineStore } from 'pinia';
import api from '../lib/api';

export const useRagStore = defineStore('rag', {
  state: () => ({
    knowledgeBases: [],
    currentKb: null,
    currentChunks: [],
    loading: false,
    ingesting: false,
    error: null,
  }),
  actions: {
    async fetchKnowledgeBases() {
      this.loading = true;
      try {
        const { data } = await api.get('/rag/knowledge-bases');
        this.knowledgeBases = data.knowledgeBases;
      } finally {
        this.loading = false;
      }
    },
    async fetchKnowledgeBase(id) {
      this.loading = true;
      try {
        const { data } = await api.get(`/rag/knowledge-bases/${id}`);
        this.currentKb = data.knowledgeBase;
      } finally {
        this.loading = false;
      }
    },
    async createKnowledgeBase(payload) {
      const { data } = await api.post('/rag/knowledge-bases', payload);
      return data.knowledgeBase;
    },
    async ingestDocument(kbId, file) {
      this.ingesting = true;
      this.error = null;
      try {
        const form = new FormData();
        form.append('file', file);
        const { data } = await api.post(`/rag/knowledge-bases/${kbId}/documents`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
        throw e;
      } finally {
        this.ingesting = false;
      }
    },
    async fetchChunks(kbId, docId) {
      const { data } = await api.get(`/rag/knowledge-bases/${kbId}/documents/${docId}/chunks`);
      this.currentChunks = data.chunks;
    },
  },
});
