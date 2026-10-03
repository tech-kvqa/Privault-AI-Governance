<template>
  <div>
    <v-row class="mb-2">
      <v-col cols="6" sm="3" v-for="c in kpiCards" :key="c.label">
        <v-card class="pa-4" height="90">
          <div class="text-caption text-medium-emphasis mb-1">{{ c.label }}</div>
          <div class="text-h5 font-weight-bold" :class="c.colorClass">{{ c.value }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="events">Events</v-tab>
      <v-tab value="policies">Policies</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="events">
        <v-row>
          <v-col cols="12" md="4">
            <v-card class="pa-5">
              <div class="text-subtitle-1 font-weight-medium mb-1">Log an event</div>
              <div class="text-caption text-medium-emphasis mb-4">
                An attached CSV/JSON file is genuinely scanned by Phase 2's PII engine — detection isn't
                guessed from the file name.
              </div>
              <v-text-field v-model="form.employeeIdentifier" label="Employee (name or email) *" class="mb-2" />
              <v-text-field v-model="form.application" label="Application (e.g. ChatGPT, Notion AI) *" class="mb-2" />
              <v-text-field v-model="form.destination" label="Destination (URL/domain)" class="mb-2" />
              <v-select v-model="form.eventType" :items="eventTypes" label="Event type" class="mb-2" />
              <v-checkbox v-model="form.isExternalAi" label="External / unauthorized AI service" density="compact" class="mb-2" />
              <v-file-input v-model="file" label="Attached file (optional)" density="comfortable" class="mb-3" show-size />
              <v-alert v-if="logError" type="error" variant="tonal" density="compact" class="mb-3">{{ logError }}</v-alert>
              <v-btn block color="primary" :loading="shadow.logging" @click="log">Log event</v-btn>
              <v-alert v-if="lastNote" :type="lastNote.startsWith('Recommended action: BLOCK') ? 'error' : 'warning'" variant="tonal" density="compact" class="mt-4">
                {{ lastNote }}
              </v-alert>
            </v-card>
          </v-col>

          <v-col cols="12" md="8">
            <v-card>
              <v-table density="comfortable">
                <thead>
                  <tr><th>Employee</th><th>Application</th><th>Type</th><th>PII</th><th>Recommended action</th><th>When</th></tr>
                </thead>
                <tbody>
                  <tr v-if="!shadow.events.length"><td colspan="6" class="text-center py-6 text-medium-emphasis">No events logged yet.</td></tr>
                  <tr v-for="e in shadow.events" :key="e.id">
                    <td>{{ e.employeeIdentifier }}</td>
                    <td class="font-weight-medium">{{ e.application }}</td>
                    <td class="text-caption">{{ typeLabel(e.eventType) }}</td>
                    <td>
                      <v-chip v-for="c in e.piiCategories" :key="c" size="small" variant="tonal" color="warning" class="mr-1 mb-1">{{ c }}</v-chip>
                      <span v-if="!e.piiCategories.length" class="text-caption text-medium-emphasis">None</span>
                    </td>
                    <td><v-chip size="small" variant="tonal" :color="actionColor(e.recommendedAction)">{{ e.recommendedAction }}</v-chip></td>
                    <td class="text-caption">{{ new Date(e.detectedAt).toLocaleString() }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="policies">
        <div class="d-flex justify-end mb-3">
          <v-btn color="primary" prepend-icon="mdi-plus" @click="policyDialog = true">New Policy</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Priority</th><th>Name</th><th>Conditions</th><th>Action</th><th>Enabled</th></tr></thead>
            <tbody>
              <tr v-if="!shadow.policies.length"><td colspan="5" class="text-center py-6 text-medium-emphasis">No policies yet — all events default to ALLOW.</td></tr>
              <tr v-for="p in shadow.policies" :key="p.id">
                <td>{{ p.priority }}</td>
                <td class="font-weight-medium">{{ p.name }}</td>
                <td class="text-caption">
                  {{ p.requireExternalAi ? 'External AI' : 'Any AI' }} + {{ p.requirePersonalData ? 'personal data detected' : 'any content' }}
                  <span v-if="p.categories.length"> ({{ p.categories.join(', ') }})</span>
                </td>
                <td><v-chip size="small" variant="tonal" :color="actionColor(p.action)">{{ p.action }}</v-chip></td>
                <td>
                  <v-switch :model-value="p.enabled" density="compact" hide-details @update:model-value="toggle(p)" />
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>
    </v-window>

    <v-dialog v-model="policyDialog" max-width="560">
      <v-card>
        <v-card-title>New Policy</v-card-title>
        <v-card-text>
          <v-text-field v-model="policyForm.name" label="Name *" class="mb-2" />
          <v-textarea v-model="policyForm.description" label="Description" rows="2" class="mb-2" />
          <v-checkbox v-model="policyForm.requireExternalAi" label="Require: external / unauthorized AI" density="compact" />
          <v-checkbox v-model="policyForm.requirePersonalData" label="Require: personal data detected" density="compact" />
          <v-combobox v-model="policyForm.categories" label="Specific categories (leave empty = any)" multiple chips closable-chips class="mb-2" />
          <v-select v-model="policyForm.action" :items="['ALLOW', 'WARN', 'BLOCK', 'REQUIRE_JUSTIFICATION', 'CREATE_INCIDENT']" label="Action" class="mb-2" />
          <v-text-field v-model.number="policyForm.priority" type="number" label="Priority (lower runs first)" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="policyDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="savingPolicy" @click="savePolicy">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useShadowAiStore } from '../stores/shadowAi';

const shadow = useShadowAiStore();
const tab = ref('events');
const file = ref(null);
const logError = ref('');
const lastNote = ref('');
const policyDialog = ref(false);
const savingPolicy = ref(false);

const eventTypes = ['AI_WEBSITE_VISIT', 'FILE_UPLOAD_TO_AI', 'API_CALL_TO_AI', 'BROWSER_EXTENSION_DETECTED', 'UNAUTHORIZED_AGENT_DETECTED'];
const form = reactive({ employeeIdentifier: '', application: '', destination: '', eventType: 'FILE_UPLOAD_TO_AI', isExternalAi: true });
const policyForm = reactive({ name: '', description: '', requireExternalAi: true, requirePersonalData: true, categories: [], action: 'WARN', priority: 0 });

onMounted(async () => {
  await Promise.all([shadow.fetchEvents(), shadow.fetchPolicies(), shadow.fetchKpis()]);
});

const kpiCards = computed(() => {
  const k = shadow.kpis || {};
  return [
    { label: 'Total events', value: k.totalEvents ?? '—' },
    { label: 'Events with PII', value: k.eventsWithPii ?? '—', colorClass: 'text-warning' },
    { label: 'Recommended blocks', value: k.recommendedBlocks ?? '—', colorClass: 'text-error' },
    { label: 'Recommended warnings', value: k.recommendedWarnings ?? '—', colorClass: 'text-warning' },
  ];
});

async function log() {
  logError.value = '';
  lastNote.value = '';
  try {
    const f = Array.isArray(file.value) ? file.value[0] : file.value;
    const result = await shadow.logEvent({ ...form }, f);
    lastNote.value = result.note || '';
    file.value = null;
    form.employeeIdentifier = '';
    await Promise.all([shadow.fetchEvents(), shadow.fetchKpis()]);
  } catch (e) {
    logError.value = shadow.error || 'Failed to log event';
  }
}

async function savePolicy() {
  savingPolicy.value = true;
  try {
    await shadow.createPolicy({ ...policyForm });
    policyDialog.value = false;
    Object.assign(policyForm, { name: '', description: '', requireExternalAi: true, requirePersonalData: true, categories: [], action: 'WARN', priority: 0 });
    await shadow.fetchPolicies();
  } finally {
    savingPolicy.value = false;
  }
}

async function toggle(policy) {
  await shadow.updatePolicy(policy.id, { enabled: !policy.enabled });
  await shadow.fetchPolicies();
}

function typeLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function actionColor(a) {
  return { ALLOW: 'success', WARN: 'warning', BLOCK: 'error', REQUIRE_JUSTIFICATION: 'warning', CREATE_INCIDENT: 'error' }[a] || 'grey';
}
</script>
