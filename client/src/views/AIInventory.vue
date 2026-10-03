<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-text-field
        v-model="q"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search AI systems…"
        hide-details
        density="comfortable"
        style="max-width: 320px"
        class="mr-3"
        @update:model-value="debouncedFetch"
      />
      <v-select
        v-model="statusFilter"
        :items="statusOptions"
        label="Status"
        hide-details
        density="comfortable"
        clearable
        style="max-width: 220px"
        class="mr-3"
        @update:model-value="fetch"
      />
      <v-select
        v-model="riskFilter"
        :items="riskOptions"
        label="Risk"
        hide-details
        density="comfortable"
        clearable
        style="max-width: 220px"
        @update:model-value="fetch"
      />
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Add AI System</v-btn>
    </div>

    <v-card>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Business function</th>
            <th>Owner</th>
            <th>Risk</th>
            <th>DPIA</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="7" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td>
          </tr>
          <tr v-else-if="!store.items.length">
            <td colspan="7" class="text-center py-6 text-medium-emphasis">No AI systems found.</td>
          </tr>
          <tr
            v-for="s in store.items"
            :key="s.id"
            class="cursor-pointer"
            @click="$router.push({ name: 'ai-system-profile', params: { id: s.id } })"
          >
            <td class="font-weight-medium">{{ s.name }}</td>
            <td>{{ s.businessFunction || '—' }}</td>
            <td>{{ s.aiGovernanceOwner?.name || '—' }}</td>
            <td><RiskChip :risk="s.riskClassification" /></td>
            <td><DpiaChip :status="s.dpiaStatus" /></td>
            <td><StatusChip :status="s.status" /></td>
            <td class="text-right" @click.stop>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" @click="openEdit(s)" />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Create / Edit dialog -->
    <v-dialog v-model="dialog" max-width="900" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center">
          {{ editing ? 'Edit AI System' : 'Add AI System' }}
          <v-spacer />
          <v-chip v-if="!editing" size="small" variant="tonal" color="info">Manually entered</v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text style="max-height: 65vh">
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field v-model="form.name" label="AI system name *" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="form.status" :items="statusOptions" label="Lifecycle status" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.description" label="Description" rows="2" />
            </v-col>

            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">Ownership</div></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.businessOwner" label="Business owner" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.technicalOwner" label="Technical owner" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.privacyOwner" label="Privacy owner" /></v-col>

            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">Model & vendor</div></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="form.vendor" label="Vendor" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="form.model" label="Model" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="form.modelProvider" label="Model provider" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="form.modelVersion" label="Model version" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.deploymentEnvironment" label="Deployment environment" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.hostingLocation" label="Hosting location" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.processingLocation" label="Processing location" /></v-col>
            <v-col cols="12" md="4">
              <v-select v-model="form.vendorId" :items="vendorsStore.items" item-title="name" item-value="id" label="Vendor record (links DPA status to risk)" clearable />
            </v-col>

            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">Purpose & data subjects</div></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.purpose" label="Purpose" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.businessFunction" label="Business function" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.userPopulation" label="User population" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.dataSubjects" label="Data subjects" /></v-col>
            <v-col cols="12" md="6">
              <v-combobox v-model="form.personalDataCategories" label="Personal data categories" multiple chips closable-chips />
            </v-col>
            <v-col cols="12" md="6">
              <v-combobox v-model="form.sensitiveDataCategories" label="Sensitive data categories" multiple chips closable-chips />
            </v-col>

            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">AI usage</div></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.trainingUsage" label="Training" density="compact" hide-details /></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.fineTuningUsage" label="Fine-tuning" density="compact" hide-details /></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.ragUsage" label="RAG" density="compact" hide-details /></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.automatedDecisionUsage" label="Automated decisions" density="compact" hide-details /></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.humanOversight" label="Human oversight" density="compact" hide-details /></v-col>
            <v-col cols="6" md="2"><v-checkbox v-model="form.crossBorderProcessing" label="Cross-border" density="compact" hide-details /></v-col>

            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">Risk & compliance</div></v-col>
            <v-col cols="12" md="4"><v-select v-model="form.riskClassification" :items="riskOptions" label="Risk classification" /></v-col>
            <v-col cols="12" md="4"><v-select v-model="form.dpiaStatus" :items="dpiaOptions" label="DPIA status" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="form.retention" label="Retention" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model.number="form.retentionPeriodDays" type="number" label="Retention period (days)" hint="Lets the platform flag erasure review (DPDP s.8(7))" persistent-hint /></v-col>
            <v-col cols="12"><div class="text-subtitle-2 text-medium-emphasis">DPDP Act flags</div></v-col>
            <v-col cols="12" md="4"><v-checkbox v-model="form.processesChildrensData" label="Processes children's data (s.9)" density="compact" hide-details /></v-col>
            <v-col cols="12" md="4"><v-checkbox v-model="form.behavioralTrackingOrAds" label="Behavioral tracking / targeted ads" density="compact" hide-details /></v-col>
            <v-col cols="12" md="4"><v-checkbox v-model="form.crossBorderRestrictedCountry" label="Transfer to restricted country (s.16, self-attested)" density="compact" hide-details /></v-col>
            <v-col cols="12">
              <v-textarea
                v-model="form.riskRationale"
                label="Risk rationale (why this classification — never rely on a bare score)"
                rows="2"
              />
            </v-col>
            <v-col cols="12"><v-textarea v-model="form.securityControls" label="Security controls" rows="2" /></v-col>
          </v-row>

          <v-alert v-if="gate" type="warning" variant="tonal" density="compact" class="mt-2">
            <div class="font-weight-medium mb-1">This can't move to {{ form.status }} yet:</div>
            <ul class="mb-2">
              <li v-for="b in gate.blockers" :key="b.code">{{ b.message }}</li>
            </ul>
            <template v-if="gate.canOverride">
              <div class="text-caption mb-1">Give a reason (at least 20 characters) to save anyway — this is recorded in the audit trail.</div>
              <v-textarea v-model="overrideReason" rows="2" density="compact" hide-details placeholder="Business justification…" />
            </template>
            <div v-else class="text-caption">Your role can't override this — ask an AI Governance Admin, Privacy Officer, DPO, or Security Admin.</div>
          </v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ gate ? 'Save & override' : editing ? 'Save changes' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useAiSystemsStore } from '../stores/aiSystems';
import { useVendorsStore } from '../stores/integrations';
import RiskChip from '../components/RiskChip.vue';
import DpiaChip from '../components/DpiaChip.vue';
import StatusChip from '../components/StatusChip.vue';

const store = useAiSystemsStore();
const vendorsStore = useVendorsStore();

const q = ref('');
const statusFilter = ref(null);
const riskFilter = ref(null);

const statusOptions = ['PROPOSED', 'ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED'];
const riskOptions = ['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const dpiaOptions = ['NOT_REQUIRED', 'REQUIRED_NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'];

let debounceTimer = null;
function debouncedFetch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetch, 300);
}

function fetch() {
  store.fetchAll({
    q: q.value || undefined,
    status: statusFilter.value || undefined,
    risk: riskFilter.value || undefined,
  });
}

onMounted(() => { fetch(); vendorsStore.fetch().catch(() => {}); });

const dialog = ref(false);
const editing = ref(null);
const saving = ref(false);
const gate = ref(null);
const overrideReason = ref('');
const gateError = ref('');

function blankForm() {
  return {
    name: '', description: '', businessOwner: '', technicalOwner: '', privacyOwner: '',
    vendor: '', model: '', modelProvider: '', modelVersion: '', deploymentEnvironment: '',
    hostingLocation: '', processingLocation: '', purpose: '', businessFunction: '',
    userPopulation: '', dataSubjects: '', personalDataCategories: [], sensitiveDataCategories: [],
    trainingUsage: false, fineTuningUsage: false, ragUsage: false, automatedDecisionUsage: false,
    humanOversight: true, crossBorderProcessing: false, retention: '', retentionPeriodDays: null,
    processesChildrensData: false, behavioralTrackingOrAds: false, crossBorderRestrictedCountry: false, vendorId: null,
    dpiaStatus: 'NOT_REQUIRED', riskClassification: 'UNCLASSIFIED', riskRationale: '',
    securityControls: '', status: 'PROPOSED',
  };
}

const form = reactive(blankForm());

function openCreate() {
  editing.value = null;
  gate.value = null;
  overrideReason.value = '';
  Object.assign(form, blankForm());
  dialog.value = true;
}

function openEdit(system) {
  editing.value = system;
  gate.value = null;
  overrideReason.value = '';
  Object.assign(form, blankForm(), system);
  dialog.value = true;
}

async function save() {
  saving.value = true;
  gateError.value = '';
  try {
    const payload = { ...form };
    if (gate.value && gate.value.canOverride && overrideReason.value.trim()) payload.gateOverrideReason = overrideReason.value.trim();
    if (editing.value) {
      await store.update(editing.value.id, payload);
    } else {
      await store.create(payload);
    }
    gate.value = null;
    overrideReason.value = '';
    dialog.value = false;
    fetch();
  } catch (e) {
    if (e.response?.status === 409 && e.response.data?.blockers) {
      gate.value = { blockers: e.response.data.blockers, canOverride: e.response.data.canOverride };
    } else {
      gateError.value = e.response?.data?.error || 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}
</script>
