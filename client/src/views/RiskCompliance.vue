<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="dpias">DPIAs</v-tab>
      <v-tab value="controls">Compliance Controls</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="dpias">
        <div class="d-flex align-center mb-3">
          <div class="text-caption text-medium-emphasis" style="max-width: 560px">
            Creating a DPIA pre-fills its 17 sections from real AI system data and a computed risk assessment
            — nothing is asked twice.
          </div>
          <v-spacer />
          <v-select v-model="newDpiaSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system" density="compact" hide-details style="max-width: 260px" class="mr-2" />
          <v-btn color="primary" :disabled="!newDpiaSystemId" :loading="creatingDpia" @click="createDpia">New DPIA</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>AI system</th><th>Status</th><th>Residual risk</th><th>Review date</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!rc.dpias.length"><td colspan="5" class="text-center py-6 text-medium-emphasis">No DPIAs yet.</td></tr>
              <tr v-for="d in rc.dpias" :key="d.id">
                <td class="font-weight-medium">{{ d.aiSystem.name }}</td>
                <td><v-chip size="small" variant="tonal" :color="dpiaColor(d.status)">{{ d.status }}</v-chip></td>
                <td><RiskChip :risk="d.residualRisk || 'UNCLASSIFIED'" /></td>
                <td>{{ d.reviewDate ? new Date(d.reviewDate).toLocaleDateString() : '—' }}</td>
                <td class="text-right"><v-btn size="small" variant="text" @click="openDpia(d)">Open</v-btn></td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <v-window-item value="controls">
        <div class="d-flex justify-end mb-3">
          <v-btn color="primary" prepend-icon="mdi-plus" @click="controlDialog = true">New Control</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Framework</th><th>Requirement</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-if="!rc.controls.length"><td colspan="4" class="text-center py-6 text-medium-emphasis">No controls mapped yet.</td></tr>
              <tr v-for="c in rc.controls" :key="c.id">
                <td><v-chip size="small" variant="tonal">{{ c.framework.replaceAll('_', ' ') }}</v-chip></td>
                <td>{{ c.requirement }}</td>
                <td class="text-caption">{{ typeLabel(c.controlType) }}</td>
                <td>
                  <v-select
                    :model-value="c.status" :items="['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_APPLICABLE']"
                    density="compact" hide-details variant="plain" style="max-width: 180px"
                    @update:model-value="(v) => updateStatus(c, v)"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- DPIA detail -->
    <v-dialog v-model="dpiaDialog" max-width="760" scrollable>
      <v-card v-if="rc.currentDpia">
        <v-card-title class="d-flex align-center">
          {{ rc.currentDpia.aiSystem.name }} — DPIA
          <v-spacer />
          <v-chip size="small" variant="tonal" :color="dpiaColor(rc.currentDpia.status)">{{ rc.currentDpia.status }}</v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text style="max-height: 60vh">
          <div v-for="(value, key) in rc.currentDpia.sections" :key="key" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">{{ sectionLabel(key) }}</div>
            <div class="text-body-2" style="white-space: pre-wrap">{{ formatSectionValue(value) }}</div>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn v-if="rc.currentDpia.status === 'DRAFT'" color="primary" @click="submitDpia">Submit for review</v-btn>
          <template v-if="rc.currentDpia.status === 'IN_REVIEW'">
            <v-btn color="error" variant="tonal" @click="decideDpia(false)">Reject</v-btn>
            <v-btn color="primary" @click="decideDpia(true)">Approve</v-btn>
          </template>
          <v-btn variant="text" @click="dpiaDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="controlDialog" max-width="560">
      <v-card>
        <v-card-title>New Compliance Control</v-card-title>
        <v-card-text>
          <v-select v-model="controlForm.framework" :items="frameworks" label="Framework *" class="mb-2" />
          <v-text-field v-model="controlForm.requirement" label="Requirement *" class="mb-2" />
          <v-text-field v-model="controlForm.control" label="Control *" class="mb-2" />
          <v-select v-model="controlForm.controlType" :items="controlTypes" label="Control type *" class="mb-2" />
          <v-select v-model="controlForm.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system (optional)" clearable class="mb-2" />
          <v-textarea v-model="controlForm.evidenceNote" label="Evidence note" rows="2" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="controlDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="savingControl" @click="saveControl">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRiskComplianceStore } from '../stores/riskCompliance';
import { useAiSystemsStore } from '../stores/aiSystems';
import RiskChip from '../components/RiskChip.vue';

const rc = useRiskComplianceStore();
const systemsStore = useAiSystemsStore();
const tab = ref('dpias');

const newDpiaSystemId = ref(null);
const creatingDpia = ref(false);
const dpiaDialog = ref(false);
const controlDialog = ref(false);
const savingControl = ref(false);

const frameworks = ['DPDP', 'GDPR', 'ISO_27701', 'ISO_27001', 'ISO_42001', 'NIST_AI_RMF', 'ORG_POLICY'];
const controlTypes = ['LEGAL_REQUIREMENT', 'ORG_POLICY', 'FRAMEWORK_CONTROL', 'RECOMMENDED_PRACTICE'];
const controlForm = reactive({ framework: 'DPDP', requirement: '', control: '', controlType: 'LEGAL_REQUIREMENT', aiSystemId: null, evidenceNote: '' });

onMounted(async () => {
  await Promise.all([rc.fetchDpias(), rc.fetchControls()]);
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

async function createDpia() {
  creatingDpia.value = true;
  try {
    await rc.createDpia(newDpiaSystemId.value);
    newDpiaSystemId.value = null;
    await rc.fetchDpias();
  } finally {
    creatingDpia.value = false;
  }
}

async function openDpia(d) {
  await rc.fetchDpia(d.id);
  dpiaDialog.value = true;
}
async function submitDpia() {
  await rc.submitDpia(rc.currentDpia.id);
  await rc.fetchDpia(rc.currentDpia.id);
  await rc.fetchDpias();
}
async function decideDpia(approve) {
  await rc.decideDpia(rc.currentDpia.id, approve);
  await rc.fetchDpia(rc.currentDpia.id);
  await rc.fetchDpias();
}

async function saveControl() {
  savingControl.value = true;
  try {
    await rc.createControl({ ...controlForm });
    controlDialog.value = false;
    Object.assign(controlForm, { framework: 'DPDP', requirement: '', control: '', controlType: 'LEGAL_REQUIREMENT', aiSystemId: null, evidenceNote: '' });
    await rc.fetchControls();
  } finally {
    savingControl.value = false;
  }
}
async function updateStatus(control, status) {
  await rc.updateControl(control.id, { status });
  await rc.fetchControls();
}

function dpiaColor(s) {
  return { DRAFT: 'grey', IN_REVIEW: 'warning', APPROVED: 'success', REJECTED: 'error' }[s] || 'grey';
}
function typeLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function sectionLabel(key) {
  return key.replace(/^\d+_/, '').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
}
function formatSectionValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? x.label || JSON.stringify(x) : x)).join(', ') : '—';
  if (typeof v === 'object') return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join('\n') || '—';
  return String(v);
}
</script>
