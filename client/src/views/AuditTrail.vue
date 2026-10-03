<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-select
        v-model="objectType"
        :items="['AiSystem', 'User']"
        label="Object type"
        clearable
        hide-details
        density="comfortable"
        style="max-width: 220px"
        class="mr-3"
        @update:model-value="load"
      />
      <v-select
        v-model="action"
        :items="actionOptions"
        label="Action"
        clearable
        hide-details
        density="comfortable"
        style="max-width: 260px"
        @update:model-value="load"
      />
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Object</th>
            <th>User</th>
            <th>Role</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td>
          </tr>
          <tr v-else-if="!logs.length">
            <td colspan="6" class="text-center py-6 text-medium-emphasis">No audit events found.</td>
          </tr>
          <tr v-for="log in logs" :key="log.id">
            <td>{{ new Date(log.timestamp).toLocaleString() }}</td>
            <td><v-chip size="small" variant="tonal">{{ formatAction(log.action) }}</v-chip></td>
            <td>{{ log.objectType }}</td>
            <td>{{ log.user?.name || 'System' }}</td>
            <td>{{ log.role || '—' }}</td>
            <td class="text-capitalize">{{ log.source }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import api from '../lib/api';

const logs = ref([]);
const loading = ref(false);
const objectType = ref(null);
const action = ref(null);

const actionOptions = ['LOGIN', 'AI_SYSTEM_CREATED', 'AI_SYSTEM_UPDATED', 'AI_SYSTEM_ARCHIVED'];

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/audit-logs', {
      params: { objectType: objectType.value || undefined, action: action.value || undefined, limit: 200 },
    });
    logs.value = data.auditLogs;
  } finally {
    loading.value = false;
  }
}

function formatAction(a) {
  return a.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

onMounted(load);
</script>
