<template>
  <v-navigation-drawer permanent width="272" class="nav-drawer">
    <div class="pa-4 pb-2">
      <div class="text-subtitle-1 font-weight-bold">PRIVault</div>
      <div class="text-caption text-medium-emphasis">AI Governance</div>
    </div>
    <v-divider />
    <v-list nav density="comfortable">
      <v-list-item
        v-for="item in items"
        :key="item.title"
        :value="item.title"
        :to="item.built ? item.to : undefined"
        :disabled="!item.built"
        :prepend-icon="item.icon"
        rounded="lg"
      >
        <v-list-item-title>{{ item.title }}</v-list-item-title>
        <template #append v-if="!item.built">
          <v-chip size="x-small" variant="tonal" color="secondary">Soon</v-chip>
        </template>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<script setup>
// One entry per destination. (An earlier version listed the master spec's 22 module names, several
// of which pointed at the same page — that made two entries highlight at once and made Vuetify warn
// about duplicate ids.) Modules with sub-views (Decisions & Appeals, AI Operations, ...) use tabs.
const items = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', to: '/dashboard', built: true },
  { title: 'AI Inventory', icon: 'mdi-robot-outline', to: '/ai-inventory', built: true },
  { title: 'Audit Trail', icon: 'mdi-clipboard-text-clock-outline', to: '/audit-trail', built: true },
  { title: 'AI Data Discovery', icon: 'mdi-magnify-scan', to: '/data-discovery', built: true },
  { title: 'Connectors', icon: 'mdi-database-cog-outline', to: '/connectors', built: true },
  { title: 'AI Data Map', icon: 'mdi-sitemap-outline', to: '/data-map', built: true },
  { title: 'Find Me in AI', icon: 'mdi-account-search-outline', to: '/find-me-in-ai', built: true },
  { title: 'RAG Governance', icon: 'mdi-database-search-outline', to: '/rag-governance', built: true },
  { title: 'Consent', icon: 'mdi-check-decagram-outline', to: '/consents', built: true },
  { title: 'AI Data Rights', icon: 'mdi-gavel', to: '/dsars', built: true },
  { title: 'Shadow AI', icon: 'mdi-eye-off-outline', to: '/shadow-ai', built: true },
  { title: 'AI Risk & DPIA', icon: 'mdi-alert-octagon-outline', to: '/risk-compliance', built: true },
  { title: 'Decisions & Appeals', icon: 'mdi-account-check-outline', to: '/decisions', built: true },
  { title: 'AI Operations', icon: 'mdi-monitor-eye', to: '/operations', built: true },
  { title: 'Vendors', icon: 'mdi-domain', to: '/vendors', built: true },
  { title: 'Evidence', icon: 'mdi-file-certificate-outline', to: '/evidence', built: true },
  { title: 'Data Principal Requests', icon: 'mdi-account-voice', to: '/intake', built: true },
  { title: 'Users', icon: 'mdi-account-multiple-outline', to: '/users', built: true },
  { title: 'Reports', icon: 'mdi-chart-box-outline', to: '/reports', built: true },
  { title: 'Settings', icon: 'mdi-cog-outline', to: '/settings', built: true },
];
</script>

<style scoped>
.nav-drawer {
  border-right: 1px solid rgb(var(--v-theme-on-surface), 0.08);
}
</style>
