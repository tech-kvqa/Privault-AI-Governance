<template>
  <div v-if="dsar">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" to="/dsars" class="mr-2" />
      <div>
        <div class="text-h6 font-weight-bold">{{ dsar.dataSubjectIdentifier }}</div>
        <div class="text-caption text-medium-emphasis">{{ typeLabel(dsar.requestType) }}</div>
      </div>
      <v-spacer />
      <v-chip size="small" variant="tonal" :color="statusColor(dsar.status)">{{ statusLabel(dsar.status) }}</v-chip>
    </div>

    <v-card class="pa-5 mb-4" v-if="dsar.status === 'RECEIVED'">
      <div class="text-subtitle-1 font-weight-medium mb-1">Step 1 — AI impact discovery</div>
      <div class="text-caption text-medium-emphasis mb-4">
        Searches the same PII index "Find Me in AI" uses, then generates remediation actions from the
        result (Section 11/12).
      </div>
      <v-btn color="primary" :loading="analyzing" @click="runAnalysis">Run impact analysis</v-btn>
    </v-card>

    <template v-else>
      <v-card class="pa-4 mb-4">
        <div class="text-subtitle-1 font-weight-medium mb-3">Impact discovered</div>
        <div v-if="!dsar.impactRecords.length" class="text-body-2 text-medium-emphasis">
          No matching indexed values found — this identifier wasn't present in any scanned data asset at
          the time of analysis.
        </div>
        <v-table density="comfortable" v-else>
          <thead><tr><th>Data asset</th><th>Column</th><th>Category</th><th>AI system</th></tr></thead>
          <tbody>
            <tr v-for="r in dsar.impactRecords" :key="r.id">
              <td>{{ r.dataAsset?.name || '—' }}</td>
              <td>{{ r.column }}</td>
              <td><v-chip size="small" variant="tonal" color="warning">{{ r.category }}</v-chip></td>
              <td>{{ r.aiSystem?.name || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <v-card class="pa-4">
        <div class="d-flex align-center justify-space-between mb-3">
          <div class="text-subtitle-1 font-weight-medium">Remediation actions</div>
          <v-btn
            v-if="dsar.status !== 'CLOSED' && allActionsDone"
            color="primary" size="small" :loading="closing" @click="closeDsar"
          >Close DSAR</v-btn>
        </div>
        <div v-if="!dsar.actions.length" class="text-body-2 text-medium-emphasis">No remediation actions were needed.</div>
        <v-table density="comfortable" v-else>
          <thead><tr><th>Action</th><th>Target</th><th>Status</th><th>Evidence</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in dsar.actions" :key="a.id">
              <td class="font-weight-medium">{{ actionLabel(a.actionType) }}</td>
              <td>{{ a.dataAsset?.name || a.aiSystem?.name || '—' }}</td>
              <td><v-chip size="small" variant="tonal" :color="actionStatusColor(a.status)">{{ actionStatusLabel(a.status) }}</v-chip></td>
              <td class="text-caption" style="max-width: 280px">{{ a.evidence || '—' }}</td>
              <td class="text-right">
                <v-btn
                  v-if="a.actionType === 'DELETE' && a.status === 'PENDING'"
                  size="small" color="primary" :loading="busyId === a.id" @click="execute(a)"
                >Execute</v-btn>
                <v-btn
                  v-else-if="a.status === 'REQUIRES_INTEGRATION'"
                  size="small" variant="tonal" @click="openAttest(a)"
                >Record evidence</v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>

    <v-dialog v-model="attestDialog" max-width="520">
      <v-card>
        <v-card-title>Record manual evidence</v-card-title>
        <v-card-subtitle class="text-wrap">
          {{ attestTarget ? actionLabel(attestTarget.actionType) : '' }} requires a live integration Privault
          doesn't have. Describe what was actually done outside Privault (Mode C evidence) — this marks the
          action "Manually attested", never "Completed" by Privault itself.
        </v-card-subtitle>
        <v-card-text>
          <v-textarea v-model="attestComments" label="What was done, where, and by whom (min. 10 characters) *" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="attestDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="attesting" :disabled="attestComments.trim().length < 10" @click="submitAttest">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <div v-else class="d-flex justify-center pa-10"><v-progress-circular indeterminate /></div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRightsStore } from '../stores/rights';

const props = defineProps({ id: String });
const rights = useRightsStore();

const analyzing = ref(false);
const closing = ref(false);
const busyId = ref(null);
const attestDialog = ref(false);
const attestTarget = ref(null);
const attestComments = ref('');
const attesting = ref(false);

const dsar = computed(() => rights.currentDsar);
const allActionsDone = computed(() => dsar.value?.actions.every((a) => a.status === 'COMPLETED' || a.status === 'MANUALLY_ATTESTED') ?? true);

onMounted(() => rights.fetchDsar(props.id));

async function runAnalysis() {
  analyzing.value = true;
  try {
    await rights.analyzeImpact(props.id);
    await rights.fetchDsar(props.id);
  } finally {
    analyzing.value = false;
  }
}

async function execute(action) {
  busyId.value = action.id;
  try {
    await rights.executeAction(props.id, action.id);
    await rights.fetchDsar(props.id);
  } finally {
    busyId.value = null;
  }
}

function openAttest(action) {
  attestTarget.value = action;
  attestComments.value = '';
  attestDialog.value = true;
}
async function submitAttest() {
  attesting.value = true;
  try {
    await rights.attestAction(props.id, attestTarget.value.id, attestComments.value.trim());
    attestDialog.value = false;
    await rights.fetchDsar(props.id);
  } finally {
    attesting.value = false;
  }
}

async function closeDsar() {
  closing.value = true;
  try {
    await rights.closeDsar(props.id);
    await rights.fetchDsar(props.id);
  } finally {
    closing.value = false;
  }
}

function typeLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function statusLabel(s) { return s.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function statusColor(s) {
  return { RECEIVED: 'grey', IMPACT_ANALYSIS: 'info', REMEDIATION_PLANNED: 'warning', IN_EXECUTION: 'warning', VERIFICATION: 'info', CLOSED: 'success' }[s] || 'grey';
}
function actionLabel(a) { return a.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function actionStatusLabel(s) { return s.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function actionStatusColor(s) {
  return { PENDING: 'grey', REQUIRES_INTEGRATION: 'warning', COMPLETED: 'success', MANUALLY_ATTESTED: 'secondary' }[s] || 'grey';
}
</script>
