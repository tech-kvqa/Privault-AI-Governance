<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 640px">
        AI Data Subject Rights requests. Impact analysis reuses the same PII index as Find Me in AI, so a
        DSAR's evidence trail matches what search would show at that moment.
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="dialog = true">New DSAR</v-btn>
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead>
          <tr><th>Data subject</th><th>Type</th><th>Status</th><th>Actions</th><th>Due</th><th>Submitted</th></tr>
        </thead>
        <tbody>
          <tr v-if="rights.loading"><td colspan="6" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td></tr>
          <tr v-else-if="!rights.dsars.length"><td colspan="6" class="text-center py-6 text-medium-emphasis">No DSARs yet.</td></tr>
          <tr v-for="d in rights.dsars" :key="d.id" class="cursor-pointer" @click="$router.push({ name: 'dsar-detail', params: { id: d.id } })">
            <td class="font-weight-medium">
              {{ d.dataSubjectIdentifier }}
              <v-chip v-if="d.actingNominee" size="x-small" variant="tonal" color="secondary" class="ml-1">via nominee: {{ d.actingNominee.nomineeName }}</v-chip>
            </td>
            <td>{{ typeLabel(d.requestType) }}</td>
            <td><v-chip size="small" variant="tonal" :color="statusColor(d.status)">{{ statusLabel(d.status) }}</v-chip></td>
            <td>{{ d._count.actions }}</td>
            <td>
              <span v-if="!d.dueDate" class="text-caption text-medium-emphasis">—</span>
              <v-chip v-else size="small" variant="tonal" :color="isOverdue(d) ? 'error' : 'grey'">
                {{ new Date(d.dueDate).toLocaleDateString() }}{{ isOverdue(d) ? ' — overdue' : '' }}
              </v-chip>
            </td>
            <td>{{ new Date(d.submittedAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="520">
      <v-card>
        <v-card-title>New DSAR</v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field v-model="form.dataSubjectIdentifier" label="Data subject identifier *" class="mb-2" />
          <v-select v-model="form.requestType" :items="requestTypes" label="Request type *" class="mb-2" />
          <v-select
            v-if="matchingNominees.length"
            v-model="form.actingNomineeId" :items="matchingNominees" item-title="label" item-value="id"
            label="Raised by a registered nominee (DPDP s.14)" clearable class="mb-2"
          />
          <v-textarea v-model="form.notes" label="Notes" rows="2" />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { computed } from 'vue';
import { useRightsStore } from '../stores/rights';
import { useDpdpStore } from '../stores/dpdp';

const rights = useRightsStore();
const dpdp = useDpdpStore();
const router = useRouter();
const dialog = ref(false);
const saving = ref(false);

const requestTypes = ['ACCESS', 'CORRECTION', 'DELETION', 'RESTRICTION', 'OBJECTION', 'CONSENT_WITHDRAWAL', 'AI_PROCESSING_INQUIRY', 'AUTOMATED_DECISION_CHALLENGE'];
const form = reactive({ dataSubjectIdentifier: '', requestType: 'DELETION', notes: '', actingNomineeId: null });
const matchingNominees = computed(() =>
  dpdp.nominees
    .filter((n) => n.dataSubjectIdentifier.toLowerCase() === form.dataSubjectIdentifier.trim().toLowerCase())
    .map((n) => ({ id: n.id, label: `${n.nomineeName}${n.relationship ? ' (' + n.relationship + ')' : ''}` }))
);

onMounted(() => { rights.fetchDsars(); dpdp.fetchNominees(); });

async function save() {
  saving.value = true;
  try {
    const dsar = await rights.createDsar({ ...form, actingNomineeId: form.actingNomineeId || undefined });
    dialog.value = false;
    router.push({ name: 'dsar-detail', params: { id: dsar.id } });
  } finally {
    saving.value = false;
  }
}

function isOverdue(d) {
  return d.status !== 'CLOSED' && d.dueDate && new Date(d.dueDate) < new Date();
}
function typeLabel(t) {
  return t.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
function statusLabel(s) {
  return s.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
function statusColor(s) {
  return { RECEIVED: 'grey', IMPACT_ANALYSIS: 'info', REMEDIATION_PLANNED: 'warning', IN_EXECUTION: 'warning', VERIFICATION: 'info', CLOSED: 'success' }[s] || 'grey';
}
</script>
