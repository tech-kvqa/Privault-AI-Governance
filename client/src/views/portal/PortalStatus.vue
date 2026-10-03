<template>
  <div class="wrap">
    <div class="shell">
      <div class="text-h6 font-weight-bold mb-1">Check request status</div>
      <div class="text-body-2 text-medium-emphasis mb-6">Enter the reference and status token you received.</div>

      <template v-if="!result">
        <v-text-field v-model="reference" label="Reference (e.g. DPR-XXXXXXXX)" class="mb-2" />
        <v-text-field v-model="token" label="Status token" class="mb-2" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
        <v-btn block color="primary" :loading="busy" @click="check">Check status</v-btn>
      </template>

      <template v-else>
        <v-chip :color="stateColor(result.state)" variant="tonal" class="mb-3">{{ stateLabel(result.state) }}</v-chip>
        <div class="text-body-2 mb-3">{{ result.summary }}</div>
        <v-alert v-if="result.message" type="info" variant="tonal" density="compact" class="mb-3">{{ result.message }}</v-alert>
        <div class="text-caption text-medium-emphasis">Request: {{ result.requestLabel }}</div>
        <div class="text-caption text-medium-emphasis">Received: {{ new Date(result.receivedAt).toLocaleDateString() }}</div>
        <div class="text-caption text-medium-emphasis mb-4">Expected by: {{ new Date(result.respondBy).toLocaleDateString() }}</div>
        <v-btn variant="text" @click="result = null">Check another</v-btn>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { usePortalStore } from '../../stores/portal';

const route = useRoute();
const slug = route.params.slug;
const portal = usePortalStore();
const reference = ref('');
const token = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null);

async function check() {
  error.value = ''; busy.value = true;
  try { result.value = await portal.checkStatus(slug, reference.value.trim(), token.value.trim()); }
  catch (e) { error.value = e.response?.data?.error || 'No request matches that reference and token'; }
  finally { busy.value = false; }
}
function stateLabel(s) { return { RECEIVED: 'Received', NEEDS_INFORMATION: 'Needs information', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', NOT_ACCEPTED: 'Not accepted' }[s] || s; }
function stateColor(s) { return { RECEIVED: 'grey', NEEDS_INFORMATION: 'warning', IN_PROGRESS: 'info', COMPLETED: 'success', NOT_ACCEPTED: 'error' }[s] || 'grey'; }
</script>

<style scoped>
.wrap { min-height: 100vh; background: #F7F8FA; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; }
.shell { width: 100%; max-width: 480px; background: #FFFFFF; border: 1px solid #E1E4E8; border-radius: 12px; padding: 32px; }
</style>
