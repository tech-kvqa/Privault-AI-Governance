<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 640px">
        Vendors and processors behind your AI systems. A signed data processing agreement is a recorded fact with a
        date — an AI system linked to a vendor without one gets a higher risk score (DPDP s.8(2)).
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Add vendor</v-btn>
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead><tr><th>Vendor</th><th>Category</th><th>Country</th><th>DPA</th><th>Security review</th><th>Risk tier</th><th>AI systems</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!store.items.length"><td colspan="8" class="text-center py-6 text-medium-emphasis">No vendors recorded.</td></tr>
          <tr v-for="v in store.items" :key="v.id">
            <td class="font-weight-medium">
              {{ v.name }}
              <v-chip v-if="v.isSubProcessor" size="x-small" variant="tonal" class="ml-1">sub-processor</v-chip>
            </td>
            <td>{{ v.category || '—' }}</td>
            <td>{{ v.country || '—' }}</td>
            <td>
              <v-chip size="small" variant="tonal" :color="v.dpaSigned ? 'success' : 'error'">
                {{ v.dpaSigned ? 'Signed ' + fmt(v.dpaSignedAt) : 'No DPA on record' }}
              </v-chip>
            </td>
            <td class="text-caption">{{ v.securityReviewAt ? fmt(v.securityReviewAt) + (v.securityReviewOutcome ? ' — ' + v.securityReviewOutcome : '') : 'Not reviewed' }}</td>
            <td><RiskChip :risk="v.riskTier" /></td>
            <td>
              <span v-if="!v.aiSystems.length" class="text-caption text-medium-emphasis">None linked</span>
              <v-chip v-for="s in v.aiSystems" :key="s.id" size="small" variant="tonal" class="mr-1" @click="$router.push({ name: 'ai-system-profile', params: { id: s.id } })">{{ s.name }}</v-chip>
            </td>
            <td class="text-right"><v-btn icon="mdi-pencil-outline" variant="text" size="small" @click="openEdit(v)" /></td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="620">
      <v-card>
        <v-card-title>{{ editing ? 'Edit vendor' : 'Add vendor' }}</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6"><v-text-field v-model="form.name" label="Name *" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.category" label="Category (e.g. Model provider)" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.country" label="Country" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.contactEmail" label="Contact email" /></v-col>
            <v-col cols="12" md="6"><v-checkbox v-model="form.dpaSigned" label="Data processing agreement signed" density="compact" hide-details /></v-col>
            <v-col cols="12" md="6"><v-text-field v-if="form.dpaSigned" v-model="form.dpaSignedAt" type="date" label="DPA signed on *" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.securityReviewAt" type="date" label="Last security review" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.securityReviewOutcome" label="Review outcome" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="form.riskTier" :items="['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']" label="Risk tier" /></v-col>
            <v-col cols="12" md="6"><v-checkbox v-model="form.isSubProcessor" label="Sub-processor" density="compact" hide-details /></v-col>
            <v-col cols="12"><v-textarea v-model="form.notes" label="Notes" rows="2" /></v-col>
          </v-row>
          <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ editing ? 'Save' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useVendorsStore } from '../stores/integrations';
import RiskChip from '../components/RiskChip.vue';

const store = useVendorsStore();
const dialog = ref(false);
const editing = ref(null);
const saving = ref(false);
const error = ref('');

const blank = () => ({ name: '', category: '', country: '', contactEmail: '', dpaSigned: false, dpaSignedAt: '', securityReviewAt: '', securityReviewOutcome: '', riskTier: 'UNCLASSIFIED', isSubProcessor: false, notes: '' });
const form = reactive(blank());
const day = (d) => (d ? String(d).slice(0, 10) : '');
const fmt = (d) => (d ? new Date(d).toLocaleDateString() : '—');

onMounted(() => store.fetch());

function openCreate() { editing.value = null; error.value = ''; Object.assign(form, blank()); dialog.value = true; }
function openEdit(v) {
  editing.value = v; error.value = '';
  Object.assign(form, blank(), v, { dpaSignedAt: day(v.dpaSignedAt), securityReviewAt: day(v.securityReviewAt) });
  dialog.value = true;
}

async function save() {
  saving.value = true; error.value = '';
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  const payload = {
    name: form.name, category: form.category || null, country: form.country || null, contactEmail: form.contactEmail || null,
    dpaSigned: form.dpaSigned, dpaSignedAt: form.dpaSigned ? iso(form.dpaSignedAt) : null,
    securityReviewAt: iso(form.securityReviewAt), securityReviewOutcome: form.securityReviewOutcome || null,
    riskTier: form.riskTier, isSubProcessor: form.isSubProcessor, notes: form.notes || null,
  };
  try {
    if (editing.value) await store.update(editing.value.id, payload); else await store.create(payload);
    dialog.value = false;
    await store.fetch();
  } catch (e) {
    error.value = e.response?.data?.error || 'Failed to save vendor';
  } finally {
    saving.value = false;
  }
}
</script>
