<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="fiduciary">Data Fiduciary (DPDP)</v-tab>
      <v-tab value="nominees">Nominees (s.14)</v-tab>
      <v-tab value="webhooks">Webhooks</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="fiduciary">
        <v-row v-if="dpdp.settings">
          <v-col cols="12" md="7">
            <v-card class="pa-5">
              <div class="text-subtitle-1 font-weight-medium mb-1">Data Protection Officer — published contact</div>
              <div class="text-caption text-medium-emphasis mb-4">
                DPDP s.8(9) requires publishing business contact details of the DPO (or another person who can
                answer data principals' questions).
              </div>
              <v-text-field v-model="form.dpoName" label="Name" class="mb-2" />
              <v-text-field v-model="form.dpoEmail" label="Email" class="mb-2" />
              <v-text-field v-model="form.dpoPhone" label="Phone" class="mb-4" />

              <v-divider class="mb-4" />
              <div class="text-subtitle-1 font-weight-medium mb-1">Rights-request response window</div>
              <div class="text-caption text-medium-emphasis mb-3">
                Used to auto-set each DSAR's due date. This is your configurable operational target — confirm the
                exact period for each request type against the currently notified DPDP Rules; Privault cannot
                verify what is current.
              </div>
              <v-text-field v-model.number="form.dsarResponseDays" type="number" label="Response window (days)" style="max-width: 240px" class="mb-4" />

              <v-divider class="mb-4" />
              <v-checkbox v-model="form.significantDataFiduciary" label="We have been notified as a Significant Data Fiduciary (s.10)" density="compact" hide-details class="mb-2" />
              <template v-if="form.significantDataFiduciary">
                <v-text-field v-model="form.independentAuditorName" label="Independent data auditor" class="mb-2" />
                <v-text-field v-model="form.lastComplianceAuditAt" type="date" label="Last periodic compliance audit" class="mb-2" />
                <v-text-field v-model="form.nextComplianceAuditDueAt" type="date" label="Next audit due" class="mb-2" />
              </template>

              <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
              <v-btn color="primary" :loading="saving" @click="save">Save</v-btn>
              <span v-if="saved" class="text-caption text-success ml-3">Saved</span>
            </v-card>
          </v-col>

          <v-col cols="12" md="5">
            <v-card class="pa-5">
              <div class="text-subtitle-1 font-weight-medium mb-1">Significant Data Fiduciary obligations</div>
              <div v-if="!dpdp.settings.significantDataFiduciary" class="text-body-2 text-medium-emphasis">
                Not designated. Privault cannot verify a government notification — tick the box once you've been notified
                and the s.10 checklist appears here.
              </div>
              <v-list v-else density="compact">
                <v-list-item v-for="c in dpdp.sdfChecklist" :key="c.item">
                  <template #prepend>
                    <v-icon :color="c.done ? 'success' : 'error'">{{ c.done ? 'mdi-check-circle' : 'mdi-alert-circle-outline' }}</v-icon>
                  </template>
                  <v-list-item-title class="text-body-2" style="white-space: normal">{{ c.item }}</v-list-item-title>
                </v-list-item>
              </v-list>
              <v-alert v-if="dpdp.settings.significantDataFiduciary" type="info" variant="tonal" density="compact" class="mt-3">
                Items are derived from what is recorded here and in the DPIA module — self-reported, not externally certified.
              </v-alert>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="nominees">
        <div class="d-flex align-center mb-3">
          <div class="text-caption text-medium-emphasis" style="max-width: 560px">
            A data principal may nominate someone to exercise their rights in the event of death or incapacity
            (DPDP s.14). Registered nominees can then be attached when a DSAR is raised on their behalf.
          </div>
          <v-spacer />
          <v-btn color="primary" prepend-icon="mdi-plus" @click="nomineeDialog = true">Register nominee</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>Data principal</th><th>Nominee</th><th>Contact</th><th>Relationship</th><th>Registered</th></tr></thead>
            <tbody>
              <tr v-if="!dpdp.nominees.length"><td colspan="5" class="text-center py-6 text-medium-emphasis">No nominees registered.</td></tr>
              <tr v-for="n in dpdp.nominees" :key="n.id">
                <td class="font-weight-medium">{{ n.dataSubjectIdentifier }}</td>
                <td>{{ n.nomineeName }}</td>
                <td>{{ n.nomineeContact }}</td>
                <td>{{ n.relationship || '—' }}</td>
                <td>{{ new Date(n.registeredAt).toLocaleDateString() }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>

        <v-dialog v-model="nomineeDialog" max-width="480">
          <v-card>
            <v-card-title>Register nominee</v-card-title>
            <v-card-text>
              <v-text-field v-model="nomineeForm.dataSubjectIdentifier" label="Data principal (email / customer ID) *" class="mb-2" />
              <v-text-field v-model="nomineeForm.nomineeName" label="Nominee name *" class="mb-2" />
              <v-text-field v-model="nomineeForm.nomineeContact" label="Nominee contact *" class="mb-2" />
              <v-text-field v-model="nomineeForm.relationship" label="Relationship" />
            </v-card-text>
            <v-card-actions class="pa-4">
              <v-spacer />
              <v-btn variant="text" @click="nomineeDialog = false">Cancel</v-btn>
              <v-btn color="primary" @click="saveNominee">Register</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </v-window-item>
      <v-window-item value="webhooks">
        <div class="d-flex align-center mb-3">
          <div class="text-caption text-medium-emphasis" style="max-width: 640px">
            Every audited action is also a deliverable event (e.g. <code>DPIA_APPROVED</code>, <code>INCIDENT_CREATED</code>).
            Payloads carry ids and event names only — never personal data — and are signed with HMAC-SHA256.
            Delivery is best-effort with no retry queue; every attempt is logged below.
          </div>
          <v-spacer />
          <v-btn color="primary" prepend-icon="mdi-plus" @click="openWebhook">Add endpoint</v-btn>
        </div>
        <v-card>
          <v-table density="comfortable">
            <thead><tr><th>URL</th><th>Events</th><th>Enabled</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!hooks.endpoints.length"><td colspan="4" class="text-center py-6 text-medium-emphasis">No webhook endpoints.</td></tr>
              <tr v-for="e in hooks.endpoints" :key="e.id">
                <td class="font-weight-medium">{{ e.url }}<div class="text-caption text-medium-emphasis">{{ e.description }}</div></td>
                <td><v-chip v-for="ev in e.events" :key="ev" size="small" variant="tonal" class="mr-1 mb-1">{{ ev === '*' ? 'all events' : ev }}</v-chip></td>
                <td><v-switch :model-value="e.enabled" density="compact" hide-details @update:model-value="toggleHook(e)" /></td>
                <td class="text-right" style="white-space: nowrap">
                  <v-btn size="small" variant="text" :loading="testingId === e.id" @click="testHook(e)">Send test</v-btn>
                  <v-btn size="small" variant="text" @click="showDeliveries(e)">Deliveries</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
        <v-alert v-if="testResult" :type="testResult.error ? 'error' : 'success'" variant="tonal" density="compact" class="mt-3" closable @click:close="testResult = null">
          Test delivery: {{ testResult.error ? testResult.error : 'HTTP ' + testResult.statusCode + ' in ' + testResult.durationMs + 'ms' }}
        </v-alert>

        <v-dialog v-model="hookDialog" max-width="520">
          <v-card>
            <v-card-title>{{ createdSecret ? 'Endpoint created' : 'Add webhook endpoint' }}</v-card-title>
            <v-card-text v-if="!createdSecret">
              <v-text-field v-model="hookForm.url" label="HTTPS URL *" hint="Private, loopback and link-local addresses are refused" persistent-hint class="mb-3" />
              <v-text-field v-model="hookForm.description" label="Description" class="mb-2" />
              <v-combobox v-model="hookForm.events" label="Events (* = all)" multiple chips closable-chips hint="Event names are audit action values, e.g. DPIA_APPROVED" persistent-hint />
              <v-alert v-if="hookError" type="error" variant="tonal" density="compact" class="mt-3">{{ hookError }}</v-alert>
            </v-card-text>
            <v-card-text v-else>
              <v-alert type="warning" variant="tonal" density="compact" class="mb-3">Copy this signing secret now — it is not shown again.</v-alert>
              <code style="word-break: break-all">{{ createdSecret }}</code>
              <div class="text-caption text-medium-emphasis mt-3">
                Verify each delivery: HMAC-SHA256 of <code>{timestamp}.{raw body}</code> with this secret must equal the
                <code>X-Privault-Signature</code> header (after <code>sha256=</code>). Reject stale timestamps to stop replays.
              </div>
            </v-card-text>
            <v-card-actions class="pa-4">
              <v-spacer />
              <v-btn variant="text" @click="hookDialog = false">{{ createdSecret ? 'Done' : 'Cancel' }}</v-btn>
              <v-btn v-if="!createdSecret" color="primary" :loading="savingHook" @click="saveHook">Create</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <v-dialog v-model="deliveriesDialog" max-width="720" scrollable>
          <v-card>
            <v-card-title>Recent deliveries</v-card-title>
            <v-card-text>
              <v-table density="compact">
                <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Time</th><th>Error</th></tr></thead>
                <tbody>
                  <tr v-if="!hooks.deliveries.length"><td colspan="5" class="text-center py-4 text-medium-emphasis">No deliveries yet.</td></tr>
                  <tr v-for="d in hooks.deliveries" :key="d.id">
                    <td class="text-caption">{{ new Date(d.createdAt).toLocaleString() }}</td>
                    <td class="text-caption">{{ d.event }}</td>
                    <td><v-chip size="x-small" variant="tonal" :color="d.error ? 'error' : 'success'">{{ d.statusCode ?? 'failed' }}</v-chip></td>
                    <td class="text-caption">{{ d.durationMs }}ms</td>
                    <td class="text-caption">{{ d.error || '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-actions class="pa-4"><v-spacer /><v-btn variant="text" @click="deliveriesDialog = false">Close</v-btn></v-card-actions>
          </v-card>
        </v-dialog>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useDpdpStore } from '../stores/dpdp';
import { useWebhooksStore } from '../stores/integrations';

const dpdp = useDpdpStore();
const hooks = useWebhooksStore();
const hookDialog = ref(false);
const hookForm = reactive({ url: '', description: '', events: ['*'] });
const hookError = ref('');
const savingHook = ref(false);
const createdSecret = ref('');
const testingId = ref(null);
const testResult = ref(null);
const deliveriesDialog = ref(false);
const tab = ref('fiduciary');
const saving = ref(false);
const saved = ref(false);
const error = ref('');
const nomineeDialog = ref(false);

const form = reactive({
  dpoName: '', dpoEmail: '', dpoPhone: '', dsarResponseDays: 30,
  significantDataFiduciary: false, independentAuditorName: '', lastComplianceAuditAt: '', nextComplianceAuditDueAt: '',
});
const nomineeForm = reactive({ dataSubjectIdentifier: '', nomineeName: '', nomineeContact: '', relationship: '' });

const toDate = (v) => (v ? String(v).slice(0, 10) : '');

async function load() {
  await Promise.all([dpdp.fetchSettings(), dpdp.fetchNominees()]);
  const s = dpdp.settings;
  Object.assign(form, {
    dpoName: s.dpoName || '', dpoEmail: s.dpoEmail || '', dpoPhone: s.dpoPhone || '',
    dsarResponseDays: s.dsarResponseDays, significantDataFiduciary: s.significantDataFiduciary,
    independentAuditorName: s.independentAuditorName || '',
    lastComplianceAuditAt: toDate(s.lastComplianceAuditAt), nextComplianceAuditDueAt: toDate(s.nextComplianceAuditDueAt),
  });
}
onMounted(load);
watch(() => form.significantDataFiduciary, () => { saved.value = false; });

async function save() {
  saving.value = true; error.value = ''; saved.value = false;
  try {
    await dpdp.saveSettings({
      dpoName: form.dpoName || null,
      dpoEmail: form.dpoEmail || null,
      dpoPhone: form.dpoPhone || null,
      dsarResponseDays: form.dsarResponseDays,
      significantDataFiduciary: form.significantDataFiduciary,
      independentAuditorName: form.independentAuditorName || null,
      lastComplianceAuditAt: form.lastComplianceAuditAt ? new Date(form.lastComplianceAuditAt).toISOString() : null,
      nextComplianceAuditDueAt: form.nextComplianceAuditDueAt ? new Date(form.nextComplianceAuditDueAt).toISOString() : null,
    });
    saved.value = true;
  } catch (e) {
    error.value = e.response?.data?.error || 'Failed to save (your role may not have permission to manage settings)';
  } finally {
    saving.value = false;
  }
}

function openWebhook() {
  createdSecret.value = ''; hookError.value = '';
  Object.assign(hookForm, { url: '', description: '', events: ['*'] });
  hookDialog.value = true;
}
async function saveHook() {
  savingHook.value = true; hookError.value = '';
  try {
    const result = await hooks.create({ url: hookForm.url, description: hookForm.description || undefined, events: hookForm.events.length ? hookForm.events : ['*'] });
    createdSecret.value = result.signingSecret;
    await hooks.fetch();
  } catch (e) {
    hookError.value = e.response?.data?.error || 'Failed to create endpoint';
  } finally {
    savingHook.value = false;
  }
}
async function toggleHook(e) { await hooks.update(e.id, { enabled: !e.enabled }); await hooks.fetch(); }
async function testHook(e) {
  testingId.value = e.id; testResult.value = null;
  try { testResult.value = await hooks.test(e.id); } catch (err) { testResult.value = { error: err.response?.data?.error || 'Test failed' }; }
  finally { testingId.value = null; }
}
async function showDeliveries(e) { await hooks.fetchDeliveries(e.id); deliveriesDialog.value = true; }
watch(tab, (t) => { if (t === 'webhooks') hooks.fetch().catch(() => {}); });

async function saveNominee() {
  await dpdp.registerNominee({ ...nomineeForm });
  nomineeDialog.value = false;
  Object.assign(nomineeForm, { dataSubjectIdentifier: '', nomineeName: '', nomineeContact: '', relationship: '' });
  await dpdp.fetchNominees();
}
</script>
