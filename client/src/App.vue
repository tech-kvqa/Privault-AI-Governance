<template>
  <v-app>
    <template v-if="isAuthPage">
      <router-view />
    </template>
    <template v-else>
      <NavDrawer />
      <v-app-bar flat class="app-bar" height="64">
        <v-app-bar-title class="text-subtitle-1 font-weight-medium">
          {{ pageTitle }}
        </v-app-bar-title>
        <v-spacer />
        <div class="d-flex align-center mr-4" v-if="auth.user">
          <v-chip size="small" variant="tonal" color="primary" class="mr-2">{{ roleLabel }}</v-chip>
          <span class="text-body-2 mr-3">{{ auth.user.name }}</span>
          <v-btn icon="mdi-logout" variant="text" size="small" @click="logout" title="Log out" />
        </div>
      </v-app-bar>
      <v-main class="app-main">
        <v-container fluid class="pa-6">
          <router-view />
        </v-container>
      </v-main>
    </template>
  </v-app>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import NavDrawer from './components/NavDrawer.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isAuthPage = computed(() => route.meta.public);
const roleLabel = computed(() => (auth.user?.role || '').replaceAll('_', ' '));

const titles = {
  dashboard: 'Dashboard',
  'ai-inventory': 'AI System Inventory',
  'ai-system-profile': 'AI System Profile',
  'audit-trail': 'Audit Trail',
  'data-discovery': 'AI Data Discovery',
  'data-asset-detail': 'Data Asset',
  'data-map': 'AI Data Map',
  'find-me-in-ai': 'Find Me in AI',
  consents: 'Consent Management',
  dsars: 'AI Data Subject Rights',
  'dsar-detail': 'DSAR',
  'rag-governance': 'RAG Governance',
  'rag-kb-detail': 'Knowledge Base',
  'shadow-ai': 'Shadow AI',
  'risk-compliance': 'AI Risk & Compliance',
  decisions: 'Decisions & Appeals',
  operations: 'AI Operations',
  reports: 'Reports',
  settings: 'Settings',
  connectors: 'Connectors',
  vendors: 'Vendors & Processors',
  evidence: 'Evidence',
};
const pageTitle = computed(() => titles[route.name] || 'PRIVault AI Governance');

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>

<style scoped>
.app-bar {
  border-bottom: 1px solid rgb(var(--v-theme-on-surface), 0.08);
}
.app-main {
  background: rgb(var(--v-theme-background));
}
</style>
