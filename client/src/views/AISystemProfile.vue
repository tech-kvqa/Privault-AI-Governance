<template>
  <div v-if="s">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" to="/ai-inventory" class="mr-2" />
      <div>
        <div class="text-h6 font-weight-bold">{{ s.name }}</div>
        <div class="text-caption text-medium-emphasis">{{ s.businessFunction || 'No business function set' }}</div>
      </div>
      <v-spacer />
      <RiskChip :risk="s.riskClassification" class="mr-2" />
      <StatusChip :status="s.status" class="mr-2" />
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn icon="mdi-dots-vertical" variant="text" v-bind="menuProps" />
        </template>
        <v-list>
          <v-list-item @click="doArchive" :disabled="s.status === 'RETIRED'">
            <v-list-item-title>Retire / archive this system</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <v-alert v-if="s.dataSourceType === 'USER_ENTERED'" type="info" variant="tonal" density="compact" class="mb-4">
      This record's data is manually entered, not connector-verified. Automated discovery ships in Phase 2.
    </v-alert>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="overview">Overview</v-tab>
      <v-tab value="data">Data</v-tab>
      <v-tab value="models">Models & Deployment</v-tab>
      <v-tab value="risk">Risk & DPIA</v-tab>
      <v-tab value="audit">Audit Trail</v-tab>
      <v-tab value="more">Other modules</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="overview">
        <v-card class="pa-4">
          <v-row>
            <v-col cols="12" md="6"><Field label="Description" :value="s.description" /></v-col>
            <v-col cols="12" md="6"><Field label="Purpose" :value="s.purpose" /></v-col>
            <v-col cols="12" md="4"><Field label="Business owner" :value="s.businessOwner" /></v-col>
            <v-col cols="12" md="4"><Field label="Technical owner" :value="s.technicalOwner" /></v-col>
            <v-col cols="12" md="4"><Field label="Privacy owner" :value="s.privacyOwner" /></v-col>
            <v-col cols="12" md="4"><Field label="AI governance owner" :value="s.aiGovernanceOwner?.name" /></v-col>
            <v-col cols="12" md="4"><Field label="Approval status" :value="s.approvalStatus" /></v-col>
            <v-col cols="12" md="4"><Field label="Last assessment" :value="fmtDate(s.lastAssessmentAt)" /></v-col>
          </v-row>
        </v-card>
      </v-window-item>

      <v-window-item value="data">
        <v-card class="pa-4">
          <v-row>
            <v-col cols="12" md="6"><Field label="Data subjects" :value="s.dataSubjects" /></v-col>
            <v-col cols="12" md="6"><Field label="User population" :value="s.userPopulation" /></v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis mb-1">Personal data categories</div>
              <v-chip v-for="c in s.personalDataCategories" :key="c" size="small" class="mr-1 mb-1">{{ c }}</v-chip>
              <span v-if="!s.personalDataCategories?.length" class="text-body-2 text-medium-emphasis">None recorded</span>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis mb-1">Sensitive data categories</div>
              <v-chip v-for="c in s.sensitiveDataCategories" :key="c" size="small" color="warning" variant="tonal" class="mr-1 mb-1">{{ c }}</v-chip>
              <span v-if="!s.sensitiveDataCategories?.length" class="text-body-2 text-medium-emphasis">None recorded</span>
            </v-col>
            <v-col cols="12" md="4"><Field label="Retention" :value="s.retention" /></v-col>
            <v-col cols="12" md="4"><Field label="Cross-border processing" :value="s.crossBorderProcessing ? 'Yes' : 'No'" /></v-col>
            <v-col cols="12" md="4"><Field label="Retention period" :value="s.retentionPeriodDays ? s.retentionPeriodDays + ' days' : '—'" /></v-col>
          </v-row>
          <div class="text-subtitle-2 font-weight-medium mt-2 mb-2">DPDP Act indicators</div>
          <v-chip size="small" variant="tonal" :color="s.processesChildrensData ? 'warning' : 'grey'" class="mr-2 mb-1">
            {{ s.processesChildrensData ? "Processes children's data (s.9)" : "No children's data" }}
          </v-chip>
          <v-chip v-if="s.processesChildrensData && s.behavioralTrackingOrAds" size="small" variant="flat" color="error" class="mr-2 mb-1">
            Behavioral tracking / ads on children's data — prohibited (s.9)
          </v-chip>
          <v-chip size="small" variant="tonal" :color="s.crossBorderRestrictedCountry ? 'error' : 'grey'" class="mr-2 mb-1">
            {{ s.crossBorderRestrictedCountry ? 'Restricted-country transfer, self-attested (s.16)' : 'No restricted-country transfer attested' }}
          </v-chip>

          <v-divider class="my-4" />
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-2 font-weight-medium">Linked data assets (from real scans)</div>
            <v-btn size="small" variant="text" :to="{ path: '/data-discovery' }">Scan a file →</v-btn>
          </div>
          <v-table density="comfortable" v-if="linkedAssets.length">
            <thead><tr><th>File</th><th>Rows</th><th>PII found</th></tr></thead>
            <tbody>
              <tr v-for="a in linkedAssets" :key="a.id" class="cursor-pointer" @click="$router.push({ name: 'data-asset-detail', params: { id: a.id } })">
                <td class="font-weight-medium">{{ a.name }}</td>
                <td>{{ a.rowCount ?? '—' }}</td>
                <td>
                  <v-chip v-for="f in a.findings" :key="f.category" size="small" variant="tonal" color="warning" class="mr-1 mb-1">{{ f.category }}</v-chip>
                  <span v-if="!a.findings.length" class="text-caption text-medium-emphasis">None detected</span>
                </td>
              </tr>
            </tbody>
          </v-table>
          <v-alert v-else type="info" variant="tonal" density="compact">
            No data asset has been scanned and linked to this AI system yet. RAG/vector-store connectors ship in Phase 3.
          </v-alert>
        </v-card>
      </v-window-item>

      <v-window-item value="models">
        <v-card class="pa-4">
          <v-row>
            <v-col cols="12" md="4"><Field label="Vendor" :value="s.vendorRecord ? s.vendorRecord.name + (s.vendorRecord.dpaSigned ? ' (DPA signed)' : ' — NO DPA on record') : s.vendor" /></v-col>
            <v-col cols="12" md="4"><Field label="Model" :value="s.model" /></v-col>
            <v-col cols="12" md="4"><Field label="Model provider" :value="s.modelProvider" /></v-col>
            <v-col cols="12" md="4"><Field label="Model version" :value="s.modelVersion" /></v-col>
            <v-col cols="12" md="4"><Field label="Deployment environment" :value="s.deploymentEnvironment" /></v-col>
            <v-col cols="12" md="4"><Field label="Hosting location" :value="s.hostingLocation" /></v-col>
            <v-col cols="12" md="4"><Field label="Processing location" :value="s.processingLocation" /></v-col>
            <v-col cols="12" md="8">
              <div class="text-caption text-medium-emphasis mb-2">AI usage</div>
              <v-chip v-if="s.trainingUsage" size="small" class="mr-1 mb-1">Training</v-chip>
              <v-chip v-if="s.fineTuningUsage" size="small" class="mr-1 mb-1">Fine-tuning</v-chip>
              <v-chip v-if="s.ragUsage" size="small" class="mr-1 mb-1">RAG</v-chip>
              <v-chip v-if="s.automatedDecisionUsage" size="small" color="warning" variant="tonal" class="mr-1 mb-1">Automated decisions</v-chip>
              <v-chip v-if="!s.humanOversight" size="small" color="error" variant="tonal" class="mr-1 mb-1">No human oversight</v-chip>
            </v-col>
          </v-row>
        </v-card>
      </v-window-item>

      <v-window-item value="risk">
        <v-card class="pa-4">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-2 font-weight-medium">Computed risk assessment</div>
            <v-btn size="small" color="primary" variant="tonal" :loading="assessing" @click="runAssessment">Assess risk</v-btn>
          </div>
          <v-row>
            <v-col cols="12" md="4"><Field label="Risk classification"><RiskChip :risk="s.riskClassification" /></Field></v-col>
            <v-col cols="12" md="4"><Field label="DPIA status"><DpiaChip :status="s.dpiaStatus" /></Field></v-col>
            <v-col cols="12" md="4"><Field label="Last assessed" :value="fmtDate(s.lastAssessmentAt)" /></v-col>
            <v-col cols="12"><Field label="Risk rationale" :value="s.riskRationale" /></v-col>
            <v-col cols="12"><Field label="Security controls" :value="s.securityControls" /></v-col>
          </v-row>
          <v-alert type="info" variant="tonal" density="compact" class="mt-2">
            "Assess risk" computes this from real fields (personal/sensitive data, automated decisions, human
            oversight, cross-border transfer, training/RAG usage, DPIA status) — the rationale above always
            names which factors fired, never just a number. Create a full DPIA from AI Risk & Compliance in
            the sidebar.
          </v-alert>
        </v-card>
      </v-window-item>

      <v-window-item value="audit">
        <v-card>
          <v-table density="comfortable">
            <thead>
              <tr><th>When</th><th>Action</th><th>By</th></tr>
            </thead>
            <tbody>
              <tr v-if="!store.currentAuditTrail.length">
                <td colspan="3" class="text-center py-6 text-medium-emphasis">No audit events yet.</td>
              </tr>
              <tr v-for="log in store.currentAuditTrail" :key="log.id">
                <td>{{ new Date(log.timestamp).toLocaleString() }}</td>
                <td>{{ formatAction(log.action) }}</td>
                <td>{{ log.user?.name || 'System' }} <span class="text-caption text-medium-emphasis">({{ log.role }})</span></td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <v-window-item value="more">
        <v-row>
          <v-col cols="12" md="4" v-for="m in lockedModules" :key="m.title">
            <v-card class="pa-4" height="100%">
              <div class="d-flex align-center justify-space-between mb-1">
                <div class="text-subtitle-2 font-weight-medium">{{ m.title }}</div>
                <v-chip size="x-small" variant="tonal" color="secondary">Phase {{ m.phase }}</v-chip>
              </div>
              <div class="text-caption text-medium-emphasis">{{ m.note }}</div>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>
    </v-window>
  </div>
  <div v-else class="d-flex justify-center pa-10">
    <v-progress-circular indeterminate />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAiSystemsStore } from '../stores/aiSystems';
import { useDataDiscoveryStore } from '../stores/dataDiscovery';
import RiskChip from '../components/RiskChip.vue';
import DpiaChip from '../components/DpiaChip.vue';
import StatusChip from '../components/StatusChip.vue';
import Field from '../components/FieldDisplay.vue';

const props = defineProps({ id: String });
const store = useAiSystemsStore();
const dd = useDataDiscoveryStore();
const router = useRouter();
const tab = ref('overview');
const assessing = ref(false);

const s = computed(() => store.current);
const linkedAssets = computed(() => (s.value ? dd.assetsForSystem(s.value.id) : []));

async function load() {
  await store.fetchOne(props.id);
  if (!dd.assets.length) await dd.fetchAssets();
}
onMounted(load);
watch(() => props.id, load);

async function doArchive() {
  if (!confirm(`Retire "${s.value.name}"? This sets its lifecycle status to Retired and is fully audited.`)) return;
  await store.archive(s.value.id, 'Retired from AI System Profile');
  await load();
}

async function runAssessment() {
  assessing.value = true;
  try {
    await store.assessRisk(s.value.id);
    await load();
  } finally {
    assessing.value = false;
  }
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}
function formatAction(action) {
  return action.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

const lockedModules = [
  { title: 'Vendors & Evidence', phase: 10, note: 'Now available from the sidebar. Link a vendor record to this system via Edit in AI Inventory, and attach hashed evidence to its compliance controls.' },
];
</script>
