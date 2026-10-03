<template>
  <div>
    <div class="text-caption text-medium-emphasis mb-4" style="max-width: 640px">
      Every report is generated live from the database when you click download — not a cached or
      pre-baked file.
    </div>
    <v-row>
      <v-col cols="12" md="4" v-for="r in reportTypes" :key="r.type">
        <v-card class="pa-4" height="100%">
          <div class="text-subtitle-1 font-weight-medium mb-1">{{ r.label }}</div>
          <div class="text-caption text-medium-emphasis mb-4">{{ r.description }}</div>
          <v-btn block variant="tonal" color="primary" :loading="downloading === r.type" @click="download(r)">
            Download CSV
          </v-btn>
        </v-card>
      </v-col>
    </v-row>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-4">{{ error }}</v-alert>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import api from '../lib/api';

const downloading = ref(null);
const error = ref('');

const reportTypes = [
  { type: 'ai-inventory', label: 'AI Inventory Report', description: 'Every AI system, status, risk, DPIA status, owners.' },
  { type: 'ai-risk', label: 'AI Risk Report', description: 'Risk classification and computed rationale per AI system.' },
  { type: 'shadow-ai', label: 'Shadow AI Report', description: 'Logged Shadow AI events, PII detected, recommended actions.' },
  { type: 'dsar', label: 'AI DSAR Report', description: 'Data subject rights requests, status, action counts.' },
  { type: 'incidents', label: 'AI Incident Report', description: 'Incidents, type, severity, status, timeline.' },
  { type: 'dpdp-breach-register', label: 'DPDP Breach Register', description: 'Personal data breaches with Board / data-principal notification status (s.8(6)).' },
  { type: 'audit-evidence', label: 'AI Audit Evidence Report', description: 'Most recent 2,000 audit log entries.' },
];

async function download(r) {
  error.value = '';
  downloading.value = r.type;
  try {
    const response = await api.get(`/reports/${r.type}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${r.type}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    error.value = 'Failed to generate report';
  } finally {
    downloading.value = null;
  }
}
</script>
