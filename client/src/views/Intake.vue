<template>
  <div>
    <div class="text-caption text-medium-emphasis mb-4" style="max-width: 680px">
      Requests submitted through the public portal. Nothing is searched, exported or erased until identity is
      verified here — record how you confirmed who the requester is before opening a DSAR.
    </div>
    <v-card>
      <v-table density="comfortable">
        <thead><tr><th>Reference</th><th>Type</th><th>Requester</th><th>Contact</th><th>Received</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!store.items.length"><td colspan="7" class="text-center py-6 text-medium-emphasis">No portal requests.</td></tr>
          <tr v-for="i in store.items" :key="i.id">
            <td class="font-weight-medium">{{ i.reference }}</td>
            <td class="text-caption">{{ typeLabel(i.requestType) }}</td>
            <td>{{ i.requesterName }} <v-chip v-if="i.isNominee" size="x-small" variant="tonal" class="ml-1">nominee</v-chip></td>
            <td class="text-caption">{{ i.contactValue }}</td>
            <td class="text-caption">{{ new Date(i.receivedAt).toLocaleDateString() }}</td>
            <td><v-chip size="small" variant="tonal" :color="statusColor(i.status)">{{ i.status.replaceAll('_',' ') }}</v-chip></td>
            <td class="text-right" style="white-space: nowrap">
              <template v-if="i.status === 'UNVERIFIED' || i.status === 'NEEDS_INFO'">
                <v-btn size="small" variant="text" color="primary" @click="openVerify(i)">Verify</v-btn>
                <v-btn size="small" variant="text" @click="openInfo(i)">Ask for info</v-btn>
                <v-btn size="small" variant="text" color="error" @click="openReject(i)">Reject</v-btn>
              </template>
              <v-btn v-else-if="i.dsarId" size="small" variant="text" :to="{ name: 'dsar-detail', params: { id: i.dsarId } }">Open DSAR</v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="verifyDialog" max-width="520">
      <v-card>
        <v-card-title>Verify identity — {{ target?.reference }}</v-card-title>
        <v-card-text>
          <v-select v-model="verifyForm.method" :items="methods" label="How was identity confirmed? *" class="mb-2" />
          <v-textarea v-model="verifyForm.note" label="Note (at least 10 characters) *" rows="2" class="mb-2" />
          <v-text-field v-model="verifyForm.dataSubjectIdentifier" label="Identifier in our systems (email, customer ID…) *" class="mb-2" />
          <v-select v-if="matchingNominees.length" v-model="verifyForm.actingNomineeId" :items="matchingNominees" item-title="label" item-value="id" label="Acting nominee (DPDP s.14)" clearable />
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="verifyDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="submitVerify">Verify & open DSAR</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="infoDialog" max-width="480">
      <v-card>
        <v-card-title>Ask the requester for more information</v-card-title>
        <v-card-text><v-textarea v-model="infoMessage" label="Message shown to the requester *" rows="3" /></v-card-text>
        <v-card-actions class="pa-4"><v-spacer /><v-btn variant="text" @click="infoDialog = false">Cancel</v-btn><v-btn color="primary" @click="submitInfo">Send</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="480">
      <v-card>
        <v-card-title>Reject this request</v-card-title>
        <v-card-text><v-textarea v-model="rejectReason" label="Reason shown to the requester *" rows="3" /></v-card-text>
        <v-card-actions class="pa-4"><v-spacer /><v-btn variant="text" @click="rejectDialog = false">Cancel</v-btn><v-btn color="error" @click="submitReject">Reject</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useIntakeStore } from '../stores/intake';
import { useDpdpStore } from '../stores/dpdp';

const store = useIntakeStore();
const dpdp = useDpdpStore();
const methods = ['EMAIL_CALLBACK', 'PHONE_CALLBACK', 'DOCUMENT_CHECK', 'ACCOUNT_LOGIN', 'IN_PERSON', 'OTHER'];

const verifyDialog = ref(false);
const target = ref(null);
const verifyForm = reactive({ method: 'EMAIL_CALLBACK', note: '', dataSubjectIdentifier: '', actingNomineeId: null });
const error = ref('');
const infoDialog = ref(false);
const infoMessage = ref('');
const rejectDialog = ref(false);
const rejectReason = ref('');

const matchingNominees = computed(() =>
  dpdp.nominees.filter((n) => n.dataSubjectIdentifier.toLowerCase() === (verifyForm.dataSubjectIdentifier || '').trim().toLowerCase())
    .map((n) => ({ id: n.id, label: `${n.nomineeName}${n.relationship ? ' (' + n.relationship + ')' : ''}` }))
);

onMounted(() => { store.fetch(); dpdp.fetchNominees(); });

function openVerify(i) { target.value = i; error.value = ''; Object.assign(verifyForm, { method: 'EMAIL_CALLBACK', note: '', dataSubjectIdentifier: i.dataSubjectIdentifier || '', actingNomineeId: null }); verifyDialog.value = true; }
async function submitVerify() {
  error.value = '';
  try { await store.verify(target.value.id, { ...verifyForm, actingNomineeId: verifyForm.actingNomineeId || undefined }); verifyDialog.value = false; await store.fetch(); }
  catch (e) { error.value = e.response?.data?.error || 'Could not verify'; }
}
function openInfo(i) { target.value = i; infoMessage.value = ''; infoDialog.value = true; }
async function submitInfo() { await store.requestInfo(target.value.id, infoMessage.value); infoDialog.value = false; await store.fetch(); }
function openReject(i) { target.value = i; rejectReason.value = ''; rejectDialog.value = true; }
async function submitReject() { await store.reject(target.value.id, rejectReason.value); rejectDialog.value = false; await store.fetch(); }

function typeLabel(t) { return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function statusColor(s) { return { UNVERIFIED: 'grey', NEEDS_INFO: 'warning', VERIFIED: 'success', REJECTED: 'error' }[s] || 'grey'; }
</script>
