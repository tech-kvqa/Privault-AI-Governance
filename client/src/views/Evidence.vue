<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 680px">
        Control evidence with cryptographic provenance: a SHA-256 is computed at upload, and re-computed from the
        stored bytes on every download and verify — a mismatch blocks the download. Whoever uploads evidence cannot be
        the one who accepts it.
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-upload" @click="openUpload">Upload evidence</v-btn>
    </div>

    <v-alert v-if="verifyResult" :type="verifyResult.intact ? 'success' : 'error'" variant="tonal" density="compact" class="mb-3" closable @click:close="verifyResult = null">
      {{ verifyResult.intact ? 'Integrity verified — stored bytes match the hash recorded at upload.' : 'INTEGRITY FAILURE — stored bytes no longer match the hash recorded at upload.' }}
      <div class="text-caption mt-1">stored {{ verifyResult.storedHash }}<br />computed {{ verifyResult.computedHash }}</div>
    </v-alert>
    <v-alert v-if="actionError" type="error" variant="tonal" density="compact" class="mb-3" closable @click:close="actionError = ''">{{ actionError }}</v-alert>

    <v-card>
      <v-table density="comfortable">
        <thead><tr><th>Title</th><th>Linked to</th><th>File</th><th>SHA-256</th><th>Valid until</th><th>Review</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!store.items.length"><td colspan="7" class="text-center py-6 text-medium-emphasis">No evidence uploaded yet.</td></tr>
          <tr v-for="e in store.items" :key="e.id">
            <td class="font-weight-medium">{{ e.title }}<div class="text-caption text-medium-emphasis">by {{ e.uploadedBy?.name || '—' }}</div></td>
            <td class="text-caption">
              <div v-if="e.control">{{ e.control.framework.replaceAll('_', ' ') }}: {{ e.control.requirement }}</div>
              <div v-if="e.aiSystem">{{ e.aiSystem.name }}</div>
              <span v-if="!e.control && !e.aiSystem" class="text-medium-emphasis">—</span>
            </td>
            <td class="text-caption">{{ e.fileName }}<div class="text-medium-emphasis">{{ (e.sizeBytes / 1024).toFixed(1) }} KB · {{ sourceLabel(e.sourceType) }}</div></td>
            <td><code :title="e.sha256" style="font-size: 11px">{{ e.sha256.slice(0, 12) }}…</code></td>
            <td>
              <span v-if="!e.validUntil" class="text-caption text-medium-emphasis">No expiry</span>
              <v-chip v-else size="small" variant="tonal" :color="e.expired ? 'error' : 'grey'">{{ new Date(e.validUntil).toLocaleDateString() }}{{ e.expired ? ' — expired' : '' }}</v-chip>
            </td>
            <td>
              <v-chip size="small" variant="tonal" :color="reviewColor(e.reviewStatus)">{{ e.reviewStatus }}</v-chip>
              <div v-if="e.reviewer" class="text-caption text-medium-emphasis">{{ e.reviewer.name }}</div>
            </td>
            <td class="text-right" style="white-space: nowrap">
              <v-btn size="small" variant="text" @click="download(e)">Download</v-btn>
              <v-btn size="small" variant="text" @click="verify(e)">Verify</v-btn>
              <template v-if="e.reviewStatus === 'PENDING'">
                <v-btn size="small" variant="text" color="success" @click="accept(e)">Accept</v-btn>
                <v-btn size="small" variant="text" color="error" @click="openReject(e)">Reject</v-btn>
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="uploadDialog" max-width="560">
      <v-card>
        <v-card-title>Upload evidence</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.title" label="Title *" class="mb-2" />
          <v-textarea v-model="form.description" label="Description" rows="2" class="mb-2" />
          <v-select v-model="form.controlId" :items="controlItems" item-title="label" item-value="id" label="Supports compliance control" clearable class="mb-2" />
          <v-select v-model="form.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="AI system" clearable class="mb-2" />
          <v-text-field v-model="form.validUntil" type="date" label="Valid until" class="mb-2" />
          <v-file-input v-model="file" label="File * (pdf, png, jpg, txt, csv, json, md, docx, xlsx, log — max 5MB)" show-size />
          <v-alert v-if="uploadError" type="error" variant="tonal" density="compact" class="mt-2">{{ uploadError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="uploadDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="store.uploading" :disabled="!form.title || !file" @click="upload">Upload</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="440">
      <v-card>
        <v-card-title>Reject evidence</v-card-title>
        <v-card-text><v-textarea v-model="rejectNote" label="Reason (required) *" rows="3" /></v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">Cancel</v-btn>
          <v-btn color="error" :disabled="!rejectNote.trim()" @click="reject">Reject</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useEvidenceStore } from '../stores/integrations';
import { useRiskComplianceStore } from '../stores/riskCompliance';
import { useAiSystemsStore } from '../stores/aiSystems';

const store = useEvidenceStore();
const rc = useRiskComplianceStore();
const systemsStore = useAiSystemsStore();

const uploadDialog = ref(false);
const uploadError = ref('');
const file = ref(null);
const form = reactive({ title: '', description: '', controlId: null, aiSystemId: null, validUntil: '' });
const verifyResult = ref(null);
const actionError = ref('');
const rejectDialog = ref(false);
const rejectNote = ref('');
const rejectTarget = ref(null);

const controlItems = computed(() => rc.controls.map((c) => ({ id: c.id, label: `${c.framework.replaceAll('_', ' ')}: ${c.requirement}` })));

onMounted(async () => {
  await store.fetch();
  rc.fetchControls().catch(() => {});
  if (!systemsStore.items.length) systemsStore.fetchAll();
});

function openUpload() { uploadError.value = ''; file.value = null; Object.assign(form, { title: '', description: '', controlId: null, aiSystemId: null, validUntil: '' }); uploadDialog.value = true; }

async function upload() {
  uploadError.value = '';
  const f = Array.isArray(file.value) ? file.value[0] : file.value;
  try {
    await store.upload({ ...form }, f);
    uploadDialog.value = false;
    await store.fetch();
  } catch (e) {
    uploadError.value = e.response?.data?.error || 'Upload failed';
  }
}

async function guarded(fn) {
  actionError.value = '';
  try { await fn(); } catch (e) {
    let msg = e.response?.data?.error;
    if (!msg && e.response?.data instanceof Blob) { try { msg = JSON.parse(await e.response.data.text()).error; } catch { /* ignore */ } }
    actionError.value = msg || 'Action failed';
  }
}
const download = (e) => guarded(() => store.download(e));
const verify = (e) => guarded(async () => { verifyResult.value = await store.verify(e.id); });
const accept = (e) => guarded(async () => { await store.review(e.id, 'ACCEPTED'); await store.fetch(); });
function openReject(e) { rejectTarget.value = e; rejectNote.value = ''; rejectDialog.value = true; }
const reject = () => guarded(async () => { await store.review(rejectTarget.value.id, 'REJECTED', rejectNote.value.trim()); rejectDialog.value = false; await store.fetch(); });

const reviewColor = (s) => ({ PENDING: 'grey', ACCEPTED: 'success', REJECTED: 'error' }[s] || 'grey');
const sourceLabel = (s) => ({ MANUAL_UPLOAD: 'manual upload', USER_ENTERED: 'user entered', AUTOMATIC: 'automatic', CONNECTOR: 'connector', API: 'API' }[s] || s);
</script>
