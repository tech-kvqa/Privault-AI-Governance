<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 640px">
        Withdrawing a consent automatically creates a Consent-Withdrawal DSAR, runs impact analysis against
        the AI Data Discovery index, and generates remediation actions (Section 10) — it's a real workflow,
        not a status flip.
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="dialog = true">Record Consent</v-btn>
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Data subject</th><th>Purpose</th><th>AI system</th><th>Legal basis</th><th>Minor / parental consent</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rights.loading"><td colspan="7" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td></tr>
          <tr v-else-if="!rights.consents.length"><td colspan="7" class="text-center py-6 text-medium-emphasis">No consent records yet.</td></tr>
          <tr v-for="c in rights.consents" :key="c.id">
            <td class="font-weight-medium">{{ c.dataSubjectIdentifier }}</td>
            <td>{{ c.purpose }}</td>
            <td>{{ c.aiSystem?.name || '—' }}</td>
            <td>{{ c.legalBasis || '—' }}</td>
            <td>
              <span v-if="!c.isMinorDataSubject" class="text-caption text-medium-emphasis">Adult</span>
              <v-chip v-else size="small" variant="tonal" :color="c.parentalConsentVerified ? 'success' : 'error'">
                Minor — {{ c.parentalConsentVerified ? 'parent verified' : 'NOT verified' }}
              </v-chip>
            </td>
            <td><v-chip size="small" variant="tonal" :color="statusColor(c.status)">{{ c.status }}</v-chip></td>
            <td class="text-right">
              <v-btn v-if="c.status === 'GRANTED'" size="small" variant="text" color="error" :loading="withdrawingId === c.id" @click="withdraw(c)">
                Withdraw
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-snackbar v-model="snackbar" timeout="5000">{{ snackbarText }}</v-snackbar>

    <v-dialog v-model="dialog" max-width="600">
      <v-card>
        <v-card-title>Record Consent</v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field v-model="form.dataSubjectIdentifier" label="Data subject identifier (email, customer ID…) *" class="mb-2" />
          <v-text-field v-model="form.purpose" label="Purpose *" class="mb-2" />
          <v-select v-model="form.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system" clearable class="mb-2" />
          <v-text-field v-model="form.dataCategory" label="Data category" class="mb-2" />
          <v-text-field v-model="form.legalBasis" label="Legal basis" class="mb-2" />
          <v-text-field v-model="form.source" label="Source (e.g. Web form, Mobile app)" class="mb-2" />
          <v-checkbox v-model="form.isMinorDataSubject" label="Data subject is a minor (under 18) — DPDP s.9" density="compact" hide-details />
          <v-checkbox v-if="form.isMinorDataSubject" v-model="form.parentalConsentVerified" label="Verifiable parental / guardian consent obtained" density="compact" hide-details class="mb-2" />
          <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mt-2">{{ saveError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRightsStore } from '../stores/rights';
import { useAiSystemsStore } from '../stores/aiSystems';

const rights = useRightsStore();
const systemsStore = useAiSystemsStore();

const dialog = ref(false);
const saving = ref(false);
const withdrawingId = ref(null);
const snackbar = ref(false);
const snackbarText = ref('');

const saveError = ref('');
const form = reactive({ dataSubjectIdentifier: '', purpose: '', aiSystemId: null, dataCategory: '', legalBasis: '', source: '', isMinorDataSubject: false, parentalConsentVerified: false });

onMounted(async () => {
  await rights.fetchConsents();
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

async function save() {
  saving.value = true;
  saveError.value = '';
  try {
    await rights.createConsent({ ...form });
    dialog.value = false;
    Object.assign(form, { dataSubjectIdentifier: '', purpose: '', aiSystemId: null, dataCategory: '', legalBasis: '', source: '', isMinorDataSubject: false, parentalConsentVerified: false });
    await rights.fetchConsents();
  } catch (e) {
    saveError.value = e.response?.data?.error || 'Failed to save consent';
  } finally {
    saving.value = false;
  }
}

async function withdraw(c) {
  if (!confirm(`Withdraw consent for "${c.dataSubjectIdentifier}"? This creates a DSAR and runs impact analysis immediately.`)) return;
  withdrawingId.value = c.id;
  try {
    const result = await rights.withdrawConsent(c.id);
    snackbarText.value = `DSAR created — ${result.actionCount} remediation action(s) generated across ${result.impactRecordCount} impacted record(s).`;
    snackbar.value = true;
    await rights.fetchConsents();
  } finally {
    withdrawingId.value = null;
  }
}

function statusColor(s) {
  return { GRANTED: 'success', WITHDRAWN: 'error', PENDING: 'warning', EXPIRED: 'grey', REJECTED: 'error', NOT_REQUIRED: 'grey' }[s] || 'grey';
}
</script>
