<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="decisions">Decisions & Human Review</v-tab>
      <v-tab value="appeals">Appeals</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="decisions">
        <div class="d-flex justify-end mb-3">
          <v-btn color="primary" prepend-icon="mdi-plus" @click="decisionDialog = true">Log Decision</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>AI system</th><th>Data subject</th><th>Decision</th><th>Risk</th><th>Review status</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!store.decisions.length"><td colspan="6" class="text-center py-6 text-medium-emphasis">No decisions logged yet.</td></tr>
              <tr v-for="d in store.decisions" :key="d.id">
                <td>{{ d.aiSystem.name }}</td>
                <td>{{ d.dataSubjectIdentifier }}</td>
                <td class="font-weight-medium">{{ d.decision }}</td>
                <td><RiskChip :risk="d.riskLevel" /></td>
                <td><v-chip size="small" variant="tonal" :color="statusColor(d.reviewStatus)">{{ d.reviewStatus }}</v-chip></td>
                <td class="text-right">
                  <template v-if="d.reviewStatus === 'PENDING' || d.reviewStatus === 'ESCALATED'">
                    <v-btn size="small" variant="text" color="success" @click="review(d, 'approve')">Approve</v-btn>
                    <v-btn size="small" variant="text" color="error" @click="openReview(d, 'reject')">Reject</v-btn>
                    <v-btn size="small" variant="text" @click="openReview(d, 'override')">Override</v-btn>
                    <v-btn v-if="d.reviewStatus === 'PENDING'" size="small" variant="text" @click="review(d, 'escalate')">Escalate</v-btn>
                  </template>
                  <v-btn v-else size="small" variant="text" @click="openAppeal(d)">Log appeal</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <v-window-item value="appeals">
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Data subject</th><th>Decision</th><th>Reason</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!store.appeals.length"><td colspan="5" class="text-center py-6 text-medium-emphasis">No appeals yet.</td></tr>
              <tr v-for="a in store.appeals" :key="a.id">
                <td>{{ a.dataSubjectIdentifier }}</td>
                <td>{{ a.decision.aiSystem.name }} — {{ a.decision.decision }}</td>
                <td class="text-caption" style="max-width: 260px">{{ a.reason }}</td>
                <td><v-chip size="small" variant="tonal" :color="appealColor(a.status)">{{ a.status.replaceAll('_', ' ') }}</v-chip></td>
                <td class="text-right">
                  <v-btn v-if="a.status === 'SUBMITTED'" size="small" variant="text" @click="investigate(a)">Investigate</v-btn>
                  <v-btn v-else-if="a.status === 'UNDER_INVESTIGATION'" size="small" variant="text" color="primary" @click="openDecideAppeal(a)">Decide</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>
    </v-window>

    <v-dialog v-model="decisionDialog" max-width="520">
      <v-card>
        <v-card-title>Log Automated Decision</v-card-title>
        <v-card-text>
          <v-select v-model="decisionForm.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system *" class="mb-2" />
          <v-text-field v-model="decisionForm.dataSubjectIdentifier" label="Data subject *" class="mb-2" />
          <v-text-field v-model="decisionForm.decision" label="Decision / outcome (e.g. Declined) *" class="mb-2" />
          <v-textarea v-model="decisionForm.inputSummary" label="Input summary" rows="2" class="mb-2" />
          <v-select v-model="decisionForm.riskLevel" :items="['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']" label="Risk level" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="decisionDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveDecision">Log</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="reviewDialog" max-width="480">
      <v-card>
        <v-card-title>{{ reviewAction === 'reject' ? 'Reject decision' : 'Override decision' }}</v-card-title>
        <v-card-text>
          <v-textarea v-model="reviewReason" label="Reason (required) *" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="reviewDialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!reviewReason.trim()" @click="submitReview">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="appealDialog" max-width="480">
      <v-card>
        <v-card-title>Log Appeal</v-card-title>
        <v-card-text>
          <v-text-field v-model="appealForm.dataSubjectIdentifier" label="Data subject *" class="mb-2" />
          <v-textarea v-model="appealForm.reason" label="Reason for appeal *" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="appealDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="submitAppeal">Submit</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="decideAppealDialog" max-width="480">
      <v-card>
        <v-card-title>Decide Appeal</v-card-title>
        <v-card-text>
          <v-textarea v-model="appealOutcome" label="Outcome *" rows="3" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="decideAppealDialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!appealOutcome.trim()" @click="submitDecideAppeal">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useDecisionsStore } from '../stores/decisions';
import { useAiSystemsStore } from '../stores/aiSystems';
import RiskChip from '../components/RiskChip.vue';

const store = useDecisionsStore();
const systemsStore = useAiSystemsStore();
const route = useRoute();
const tab = ref(route.query.tab === 'appeals' ? 'appeals' : 'decisions');

const decisionDialog = ref(false);
const saving = ref(false);
const decisionForm = reactive({ aiSystemId: null, dataSubjectIdentifier: '', decision: '', inputSummary: '', riskLevel: 'MEDIUM' });

const reviewDialog = ref(false);
const reviewAction = ref('reject');
const reviewReason = ref('');
const reviewTarget = ref(null);

const appealDialog = ref(false);
const appealForm = reactive({ dataSubjectIdentifier: '', reason: '' });
const appealTarget = ref(null);

const decideAppealDialog = ref(false);
const appealOutcome = ref('');
const decideTarget = ref(null);

onMounted(async () => {
  await Promise.all([store.fetchDecisions(), store.fetchAppeals()]);
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

async function saveDecision() {
  saving.value = true;
  try {
    await store.createDecision({ ...decisionForm });
    decisionDialog.value = false;
    Object.assign(decisionForm, { aiSystemId: null, dataSubjectIdentifier: '', decision: '', inputSummary: '', riskLevel: 'MEDIUM' });
    await store.fetchDecisions();
  } finally {
    saving.value = false;
  }
}

async function review(decision, action) {
  await store.review(decision.id, action);
  await store.fetchDecisions();
}
function openReview(decision, action) {
  reviewTarget.value = decision;
  reviewAction.value = action;
  reviewReason.value = '';
  reviewDialog.value = true;
}
async function submitReview() {
  await store.review(reviewTarget.value.id, reviewAction.value, { overrideReason: reviewReason.value.trim() });
  reviewDialog.value = false;
  await store.fetchDecisions();
}

function openAppeal(decision) {
  appealTarget.value = decision;
  Object.assign(appealForm, { dataSubjectIdentifier: decision.dataSubjectIdentifier, reason: '' });
  appealDialog.value = true;
}
async function submitAppeal() {
  await store.createAppeal({ decisionId: appealTarget.value.id, ...appealForm });
  appealDialog.value = false;
  await store.fetchAppeals();
}

async function investigate(appeal) {
  await store.investigateAppeal(appeal.id);
  await store.fetchAppeals();
}
function openDecideAppeal(appeal) {
  decideTarget.value = appeal;
  appealOutcome.value = '';
  decideAppealDialog.value = true;
}
async function submitDecideAppeal() {
  await store.decideAppeal(decideTarget.value.id, appealOutcome.value.trim());
  decideAppealDialog.value = false;
  await store.fetchAppeals();
}

function statusColor(s) {
  return { PENDING: 'grey', APPROVED: 'success', REJECTED: 'error', OVERRIDDEN: 'warning', ESCALATED: 'warning' }[s] || 'grey';
}
function appealColor(s) {
  return { SUBMITTED: 'grey', UNDER_INVESTIGATION: 'warning', DECIDED: 'success' }[s] || 'grey';
}
</script>
