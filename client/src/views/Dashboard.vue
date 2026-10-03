<template>
  <div>
    <v-row>
      <v-col cols="12" sm="6" md="4" lg="2" v-for="card in kpiCards" :key="card.label">
        <v-card class="pa-4" height="120">
          <div class="text-caption text-medium-emphasis mb-1">{{ card.label }}</div>
          <div class="text-h4 font-weight-bold" :class="card.colorClass">
            <span v-if="card.value === null" class="text-medium-emphasis">…</span>
            <span v-else>{{ card.value }}</span>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-2">
      <v-col cols="12" md="7">
        <v-card class="pa-4">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-1 font-weight-medium">AI systems needing attention</div>
            <v-btn size="small" variant="text" to="/ai-inventory">View inventory</v-btn>
          </div>
          <v-table density="comfortable" v-if="attention.length">
            <thead>
              <tr>
                <th>System</th>
                <th>Risk</th>
                <th>DPIA</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in attention"
                :key="s.id"
                class="cursor-pointer"
                @click="$router.push({ name: 'ai-system-profile', params: { id: s.id } })"
              >
                <td>{{ s.name }}</td>
                <td><RiskChip :risk="s.riskClassification" /></td>
                <td><DpiaChip :status="s.dpiaStatus" /></td>
                <td><StatusChip :status="s.status" /></td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-body-2 text-medium-emphasis">No systems currently flagged.</div>
        </v-card>
      </v-col>

      <v-col cols="12" md="5">
        <v-card class="pa-4">
          <div class="text-subtitle-1 font-weight-medium mb-3">Recent activity</div>
          <v-list density="compact" v-if="recentAudit.length">
            <v-list-item v-for="log in recentAudit" :key="log.id">
              <v-list-item-title class="text-body-2">{{ formatAction(log.action) }}</v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ log.user?.name || 'System' }} · {{ new Date(log.timestamp).toLocaleString() }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div v-else class="text-body-2 text-medium-emphasis">No activity yet.</div>
          <v-btn size="small" variant="text" class="mt-2" to="/audit-trail">View full audit trail</v-btn>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAiSystemsStore } from '../stores/aiSystems';
import api from '../lib/api';
import RiskChip from '../components/RiskChip.vue';
import DpiaChip from '../components/DpiaChip.vue';
import StatusChip from '../components/StatusChip.vue';

const store = useAiSystemsStore();
const recentAudit = ref([]);

onMounted(async () => {
  await store.fetchKpis();
  await store.fetchAll();
  const { data } = await api.get('/audit-logs', { params: { limit: 8 } });
  recentAudit.value = data.auditLogs;
});

const attention = computed(() =>
  store.items.filter(
    (s) =>
      s.riskClassification === 'HIGH' ||
      s.riskClassification === 'CRITICAL' ||
      s.dpiaStatus === 'REQUIRED_NOT_STARTED' ||
      s.dpiaStatus === 'OVERDUE'
  )
);

const kpiCards = computed(() => {
  const k = store.kpis || {};
  const n = (v) => (v === undefined ? null : v);
  return [
    { label: 'AI Systems', value: n(k.aiSystems) },
    { label: 'In Production', value: n(k.aiSystemsInProduction) },
    { label: 'Processing Personal Data', value: n(k.aiSystemsProcessingPersonalData) },
    { label: 'High Risk', value: n(k.highRiskAiSystems), colorClass: 'text-error' },
    { label: 'Missing Required DPIA', value: n(k.aiSystemsMissingRequiredDpia), colorClass: 'text-warning' },
    { label: 'No Human Oversight (auto decisions)', value: n(k.automatedDecisionSystemsWithoutHumanOversight), colorClass: 'text-warning' },
    { label: 'Shadow AI Events', value: n(k.shadowAiEvents) },
    { label: 'Open AI DSARs', value: n(k.openAiDsars) },
    { label: 'Pending Human Reviews', value: n(k.pendingHumanReviews), colorClass: 'text-warning' },
    { label: 'AI Privacy Incidents (open)', value: n(k.aiPrivacyIncidents), colorClass: 'text-error' },
  ];
});

function formatAction(action) {
  return action.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
</script>
