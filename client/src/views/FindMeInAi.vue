<template>
  <div>
    <v-card class="pa-5 mb-4">
      <div class="text-subtitle-1 font-weight-medium mb-1">Find Me in AI</div>
      <div class="text-caption text-medium-emphasis mb-4">
        Search an exact identifier (email, phone, PAN, customer ID…) against every value the PII engine has
        indexed. An AI system is reported <strong>Not found</strong> only when every data asset linked to it was fully scanned; if nothing is linked, or any linked data was only sampled, it is <strong>Unknown</strong> — never a false "Not found". Matching is exact (ignoring case) and covers the PII columns Privault classified.
      </div>
      <div class="d-flex" style="gap: 12px; max-width: 560px">
        <v-text-field v-model="identifier" placeholder="e.g. ritika.gupta@abcbank.demo" hide-details density="comfortable" @keyup.enter="search" />
        <v-btn color="primary" :loading="dd.loading" @click="search">Search</v-btn>
      </div>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
    </v-card>

    <template v-if="dd.findMeResult">
      <v-card class="pa-4 mb-4">
        <div class="text-subtitle-1 font-weight-medium mb-3">Found in</div>
        <div v-if="!dd.findMeResult.foundIn.length" class="text-body-2 text-medium-emphasis">
          No matches for "{{ dd.findMeResult.identifier }}" in any scanned data asset.
        </div>
        <v-table density="comfortable" v-else>
          <thead>
            <tr><th>Data asset</th><th>Column</th><th>Category</th><th>Value</th><th>Linked AI system</th></tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in dd.findMeResult.foundIn" :key="i" class="cursor-pointer" @click="$router.push({ name: 'data-asset-detail', params: { id: f.dataAssetId } })">
              <td class="font-weight-medium">{{ f.dataAssetName }}</td>
              <td>{{ f.column }}</td>
              <td><v-chip size="small" variant="tonal" color="warning">{{ f.category }}</v-chip></td>
              <td>{{ f.value }}</td>
              <td>{{ f.aiSystem?.name || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <v-card class="pa-4">
        <div class="text-subtitle-1 font-weight-medium mb-3">AI system coverage</div>
        <v-table density="comfortable">
          <thead><tr><th>AI system</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="s in dd.findMeResult.aiSystems" :key="s.aiSystemId">
              <td>{{ s.name }}</td>
              <td>
                <v-chip size="small" variant="tonal" :color="statusColor(s.status)">{{ statusLabel(s.status) }}</v-chip>
                <div class="text-caption text-medium-emphasis mt-1">{{ s.reason }}</div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDataDiscoveryStore } from '../stores/dataDiscovery';

const dd = useDataDiscoveryStore();
const identifier = ref('');
const error = ref('');

async function search() {
  error.value = '';
  if (!identifier.value.trim()) return;
  try {
    await dd.findMeInAi(identifier.value.trim());
  } catch (e) {
    error.value = dd.error || 'Search failed';
  }
}

function statusLabel(s) {
  return { FOUND: 'Found', NOT_FOUND: 'Not found', UNKNOWN: 'Unknown' }[s] || s;
}
function statusColor(s) {
  return { FOUND: 'error', NOT_FOUND: 'success', UNKNOWN: 'grey' }[s] || 'grey';
}
</script>
