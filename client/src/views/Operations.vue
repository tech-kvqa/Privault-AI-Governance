<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="monitoring">Monitoring</v-tab>
      <v-tab value="incidents">Incidents</v-tab>
      <v-tab value="emergency">Emergency Controls</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="monitoring">
        <v-row v-if="ops.monitoring">
          <v-col cols="6" md="3" v-for="c in monitoringCards" :key="c.label">
            <v-card class="pa-4" height="100">
              <div class="text-caption text-medium-emphasis mb-1">{{ c.label }}</div>
              <div class="text-h5 font-weight-bold" :class="c.colorClass">{{ c.value }}</div>
            </v-card>
          </v-col>
        </v-row>
        <div v-if="ops.dpdp" class="mt-6">
          <div class="text-subtitle-1 font-weight-medium mb-2">DPDP & governance signals</div>
          <v-row>
            <v-col cols="6" md="3" v-for="c in dpdpCards" :key="c.label">
              <v-card class="pa-4" height="100">
                <div class="text-caption text-medium-emphasis mb-1">{{ c.label }}</div>
                <div class="text-h5 font-weight-bold" :class="c.colorClass">{{ c.value }}</div>
              </v-card>
            </v-col>
          </v-row>
          <v-alert v-if="ops.dpdp.retentionElapsedAiSystems.length" type="warning" variant="tonal" density="compact" class="mt-3">
            Retention period elapsed — review for erasure (s.8(7)): {{ ops.dpdp.retentionElapsedAiSystems.map((r) => r.name).join(', ') }}.
            {{ ops.dpdp.retentionNote }}
          </v-alert>
        </div>
      </v-window-item>

      <v-window-item value="incidents">
        <div class="d-flex justify-end mb-3">
          <v-btn color="primary" prepend-icon="mdi-plus" @click="incidentDialog = true">Log Incident</v-btn>
        </div>
        <v-alert v-if="advanceError" type="error" variant="tonal" density="compact" class="mb-3">{{ advanceError }}</v-alert>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Type</th><th>AI system</th><th>Severity</th><th>Status</th><th>Description</th><th>DPDP breach notification</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!ops.incidents.length"><td colspan="7" class="text-center py-6 text-medium-emphasis">No incidents.</td></tr>
              <tr v-for="i in ops.incidents" :key="i.id">
                <td>{{ typeLabel(i.type) }}</td>
                <td>{{ i.aiSystem?.name || i.shadowAiEvent?.application || '—' }}</td>
                <td><RiskChip :risk="i.severity" /></td>
                <td><v-chip size="small" variant="tonal" :color="statusColor(i.status)">{{ i.status }}</v-chip></td>
                <td class="text-caption" style="max-width: 280px">{{ i.description }}</td>
                <td>
                  <span v-if="!i.isPersonalDataBreach" class="text-caption text-medium-emphasis">Not a personal data breach</span>
                  <div v-else class="text-caption">
                    <div>Board: <strong :class="i.dpbNotifiedAt ? 'text-success' : 'text-error'">{{ i.dpbNotifiedAt ? 'notified' : 'NOT notified' }}</strong></div>
                    <div>Data Principals: <strong :class="i.affectedPrincipalsNotifiedAt ? 'text-success' : 'text-error'">{{ i.affectedPrincipalsNotifiedAt ? 'notified' : 'NOT notified' }}</strong></div>
                    <v-btn v-if="!i.dpbNotifiedAt || !i.affectedPrincipalsNotifiedAt" size="x-small" variant="tonal" class="mt-1" @click="openNotify(i)">Record notification</v-btn>
                  </div>
                </td>
                <td class="text-right">
                  <v-btn v-if="i.status !== 'CLOSED'" size="small" variant="text" @click="advance(i)">Advance →</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <v-window-item value="emergency">
        <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
          Only "Stop AI System" is genuinely executable by Privault — it sets the system's lifecycle status
          to Suspended. Every other control needs a live integration this deployment doesn't have and is
          logged as "requires integration," never faked as executed (Section 25/26). Suspending a system that is live in Production needs a second, different person to approve it (dual control).
        </v-alert>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>AI system</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in systemsStore.items" :key="s.id">
                <td class="font-weight-medium">{{ s.name }}</td>
                <td><StatusChip :status="s.status" /></td>
                <td class="text-right"><v-btn size="small" variant="tonal" color="error" @click="openEmergency(s)">Emergency action</v-btn></td>
              </tr>
            </tbody>
          </v-table>
        </v-card>

        <v-card class="pa-4 mt-4">
          <div class="text-subtitle-1 font-weight-medium mb-3">Action log</div>
          <v-alert v-if="decisionError" type="error" variant="tonal" density="compact" class="mb-3">{{ decisionError }}</v-alert>
          <v-table density="comfortable">
            <thead><tr><th>AI system</th><th>Action</th><th>Status</th><th>Reason</th><th>When</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!ops.emergencyActions.length"><td colspan="6" class="text-center py-6 text-medium-emphasis">No emergency actions logged.</td></tr>
              <tr v-for="a in ops.emergencyActions" :key="a.id">
                <td>{{ a.aiSystem.name }}</td>
                <td>{{ actionLabel(a.actionType) }}</td>
                <td><v-chip size="small" variant="tonal" :color="actionStatusColor(a.status)">{{ a.status.replaceAll('_', ' ') }}</v-chip>
                  <div v-if="a.approvedBy" class="text-caption text-medium-emphasis">{{ a.status === 'REJECTED' ? 'rejected' : 'approved' }} by {{ a.approvedBy.name }}</div>
                </td>
                <td class="text-caption" style="max-width: 240px">{{ a.reason }}</td>
                <td class="text-caption">{{ new Date(a.executedAt).toLocaleString() }}<div class="text-medium-emphasis">requested by {{ a.executedBy?.name || '—' }}</div></td>
                <td class="text-right" style="white-space: nowrap">
                  <template v-if="a.status === 'PENDING_APPROVAL' && a.executedBy?.id !== auth.user?.id">
                    <v-btn size="small" variant="text" color="success" @click="decideAction(a, 'approve')">Approve</v-btn>
                    <v-btn size="small" variant="text" color="error" @click="decideAction(a, 'reject')">Reject</v-btn>
                  </template>
                  <span v-else-if="a.status === 'PENDING_APPROVAL'" class="text-caption text-medium-emphasis">Awaiting a second approver</span>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>
    </v-window>

    <v-dialog v-model="incidentDialog" max-width="520">
      <v-card>
        <v-card-title>Log Incident</v-card-title>
        <v-card-text>
          <v-select v-model="incidentForm.type" :items="incidentTypes" label="Type *" class="mb-2" />
          <v-select v-model="incidentForm.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system" clearable class="mb-2" />
          <v-select v-model="incidentForm.severity" :items="['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']" label="Severity" class="mb-2" />
          <v-textarea v-model="incidentForm.description" label="Description *" rows="3" class="mb-2" />
          <v-checkbox v-model="incidentForm.isPersonalDataBreach" label="This is a personal data breach (DPDP s.8(6) notification applies)" density="compact" hide-details />
          <v-text-field v-if="incidentForm.isPersonalDataBreach" v-model.number="incidentForm.affectedDataSubjectCount" type="number" label="Affected data principals (approx.)" class="mt-2" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="incidentDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveIncident">Log</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="notifyDialog" max-width="480">
      <v-card>
        <v-card-title>Record breach notification</v-card-title>
        <v-card-subtitle class="text-wrap">
          Privault does not send notifications to the Data Protection Board or data principals — record here
          that you did, so the compliance trail is real. Confirm timelines against the notified DPDP Rules.
        </v-card-subtitle>
        <v-card-text>
          <v-checkbox v-model="notifyForm.dpbNotified" label="Data Protection Board of India notified" density="compact" hide-details />
          <v-checkbox v-model="notifyForm.principalsNotified" label="Affected data principals notified" density="compact" hide-details />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="notifyDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="submitNotify">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="emergencyDialog" max-width="480">
      <v-card>
        <v-card-title>Emergency Action — {{ emergencyTarget?.name }}</v-card-title>
        <v-card-text>
          <v-select v-model="emergencyForm.actionType" :items="emergencyTypes" label="Action *" class="mb-2" />
          <v-textarea v-model="emergencyForm.reason" label="Reason (min. 10 characters) *" rows="3" class="mb-2" />
          <v-text-field v-model="emergencyForm.ticketRef" label="Ticket reference" />
          <v-alert v-if="emergencyNote" :type="emergencyNote.startsWith('AI system status') ? 'success' : 'warning'" variant="tonal" density="compact" class="mt-3">
            {{ emergencyNote }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="emergencyDialog = false">Close</v-btn>
          <v-btn color="error" :disabled="emergencyForm.reason.trim().length < 10" @click="executeEmergency">Execute</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useOperationsStore } from '../stores/operations';
import { useAiSystemsStore } from '../stores/aiSystems';
import { useAuthStore } from '../stores/auth';
import RiskChip from '../components/RiskChip.vue';
import StatusChip from '../components/StatusChip.vue';

const ops = useOperationsStore();
const auth = useAuthStore();
const decisionError = ref('');
const systemsStore = useAiSystemsStore();
const route = useRoute();
const tab = ref(route.query.tab || 'monitoring');

const incidentDialog = ref(false);
const incidentTypes = ['PII_LEAKAGE', 'SHADOW_AI', 'UNAUTHORIZED_TRAINING', 'PROMPT_DATA_EXPOSURE', 'RAG_LEAKAGE', 'MODEL_OUTPUT_PII', 'VENDOR_BREACH', 'UNAUTHORIZED_MODEL_ACCESS', 'DATA_POISONING', 'PRIVACY_CONTROL_FAILURE'];
const incidentForm = reactive({ type: 'PII_LEAKAGE', aiSystemId: null, severity: 'MEDIUM', description: '', isPersonalDataBreach: false, affectedDataSubjectCount: null });
const notifyDialog = ref(false);
const notifyTarget = ref(null);
const notifyForm = reactive({ dpbNotified: false, principalsNotified: false });
const advanceError = ref('');

const emergencyDialog = ref(false);
const emergencyTarget = ref(null);
const emergencyNote = ref('');
const emergencyTypes = ['STOP_AI_SYSTEM', 'DISABLE_API', 'REVOKE_CREDENTIAL', 'STOP_DATA_FEED', 'DISABLE_AGENT', 'DISABLE_RAG', 'ROLLBACK_MODEL', 'ISOLATE_SERVICE'];
const emergencyForm = reactive({ actionType: 'STOP_AI_SYSTEM', reason: '', ticketRef: '' });

onMounted(async () => {
  await Promise.all([ops.fetchMonitoring(), ops.fetchIncidents(), ops.fetchEmergencyActions()]);
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

const monitoringCards = computed(() => {
  const m = ops.monitoring || {};
  return [
    { label: 'New AI systems (7d)', value: m.newAiSystemsThisWeek },
    { label: 'Shadow AI (high severity, 7d)', value: m.shadowAiHighSeverityThisWeek, colorClass: 'text-error' },
    { label: 'PII uploads detected (7d)', value: m.piiUploadsDetectedThisWeek, colorClass: 'text-warning' },
    { label: 'Consent withdrawals (7d)', value: m.consentWithdrawalsThisWeek },
    { label: 'Pending remediation actions', value: m.pendingRemediationActions, colorClass: 'text-warning' },
    { label: 'Open DSARs', value: m.openDsars },
    { label: 'Pending human reviews', value: m.pendingHumanReviews, colorClass: 'text-warning' },
    { label: 'Open incidents', value: m.openIncidents, colorClass: 'text-error' },
    { label: 'AI systems missing DPIA', value: m.aiSystemsMissingDpia, colorClass: 'text-error' },
    { label: 'Policy violations (7d)', value: m.policyViolationsThisWeek },
  ];
});

async function saveIncident() {
  await ops.createIncident({ ...incidentForm });
  incidentDialog.value = false;
  Object.assign(incidentForm, { type: 'PII_LEAKAGE', aiSystemId: null, severity: 'MEDIUM', description: '', isPersonalDataBreach: false, affectedDataSubjectCount: null });
  await ops.fetchIncidents();
}
async function advance(incident) {
  advanceError.value = '';
  try {
    await ops.advanceIncident(incident.id);
  } catch (e) {
    advanceError.value = e.response?.data?.error || 'Could not advance incident';
  }
  await ops.fetchIncidents();
}
function openNotify(incident) {
  notifyTarget.value = incident;
  Object.assign(notifyForm, { dpbNotified: !!incident.dpbNotifiedAt, principalsNotified: !!incident.affectedPrincipalsNotifiedAt });
  notifyDialog.value = true;
}
async function submitNotify() {
  await ops.recordBreachNotification(notifyTarget.value.id, { ...notifyForm });
  notifyDialog.value = false;
  await ops.fetchIncidents();
}

function openEmergency(system) {
  emergencyTarget.value = system;
  Object.assign(emergencyForm, { actionType: 'STOP_AI_SYSTEM', reason: '', ticketRef: '' });
  emergencyNote.value = '';
  emergencyDialog.value = true;
}
async function executeEmergency() {
  const result = await ops.executeEmergencyAction(emergencyTarget.value.id, { ...emergencyForm });
  emergencyNote.value = result.note || 'Done.';
  await Promise.all([ops.fetchEmergencyActions(), systemsStore.fetchAll()]);
}

const dpdpCards = computed(() => {
  const d = ops.dpdp || {};
  const g = ops.governance || {};
  return [
    { label: "AI systems processing children's data", value: d.aiSystemsProcessingChildrensData },
    { label: "Children's data + tracking/ads (prohibited, s.9)", value: d.childrensDataWithBehavioralTrackingOrAds, colorClass: 'text-error' },
    { label: 'Restricted-country transfers (s.16)', value: d.restrictedCountryTransferSystems, colorClass: 'text-warning' },
    { label: 'Minor consents without parental verification', value: d.grantedMinorConsentsWithoutParentalVerification, colorClass: 'text-error' },
    { label: 'Breaches awaiting notification (s.8(6))', value: d.personalDataBreachesAwaitingNotification, colorClass: 'text-error' },
    { label: 'Overdue DSARs', value: d.overdueDsars, colorClass: 'text-warning' },
    { label: 'Vendors in use without a DPA', value: g.vendorsInUseWithoutDpa, colorClass: 'text-error' },
    { label: 'Evidence pending review', value: g.evidencePendingReview, colorClass: 'text-warning' },
    { label: 'Expired evidence', value: g.evidenceExpired, colorClass: 'text-warning' },
    { label: 'Emergency actions awaiting approval', value: g.emergencyActionsAwaitingApproval, colorClass: 'text-error' },
    { label: 'Partially scanned data assets', value: g.dataAssetsPartiallyScanned, colorClass: 'text-warning' },
  ];
});

async function decideAction(action, verb) {
  decisionError.value = '';
  try {
    if (verb === 'approve') await ops.approveEmergencyAction(action.id);
    else await ops.rejectEmergencyAction(action.id);
    await Promise.all([ops.fetchEmergencyActions(), systemsStore.fetchAll()]);
  } catch (e) {
    decisionError.value = e.response?.data?.error || 'Could not record decision';
  }
}
const actionStatusColor = (s) => ({ EXECUTED: 'success', PENDING_APPROVAL: 'warning', REJECTED: 'grey', REQUIRES_INTEGRATION: 'warning' }[s] || 'grey');

function typeLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function actionLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function statusColor(s) {
  return { DETECTED: 'grey', CLASSIFIED: 'info', CONTAINED: 'warning', INVESTIGATING: 'warning', REMEDIATED: 'info', REVIEWED: 'info', CLOSED: 'success' }[s] || 'grey';
}
</script>
