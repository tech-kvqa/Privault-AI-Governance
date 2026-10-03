<template>
  <div>
    <v-row>
      <v-col cols="12" md="4">
        <v-card class="pa-5">
          <div class="text-subtitle-1 font-weight-medium mb-1">Scan a file</div>
          <div class="text-caption text-medium-emphasis mb-4">
            CSV or JSON, up to 10MB. Real regex/checksum/dictionary PII detection runs on upload —
            nothing here is simulated.
          </div>

          <v-file-input
            v-model="file"
            label="File (CSV or JSON)"
            accept=".csv,application/json,text/csv"
            density="comfortable"
            class="mb-3"
            show-size
          />

          <v-select
            v-model="aiSystemId"
            :items="systemOptions"
            item-title="name"
            item-value="id"
            label="Link to AI system (optional)"
            clearable
            density="comfortable"
            class="mb-3"
          />

          <v-select
            v-if="aiSystemId"
            v-model="relationship"
            :items="['FEEDS', 'TRAINED_ON', 'USED_IN_RAG']"
            label="Relationship"
            density="comfortable"
            class="mb-3"
          />

          <v-alert v-if="scanError" type="error" variant="tonal" density="compact" class="mb-3">{{ scanError }}</v-alert>

          <v-btn block color="primary" :loading="store.scanning" :disabled="!file" @click="runScan">
            Scan for PII
          </v-btn>

          <v-alert v-if="lastResult" type="success" variant="tonal" density="compact" class="mt-4">
            Scanned {{ lastResult.rowsScanned }} rows — found {{ lastResult.findings.length }}
            PII column{{ lastResult.findings.length === 1 ? '' : 's' }}.
          </v-alert>
        </v-card>

        <v-card class="pa-5 mt-4">
          <div class="text-subtitle-1 font-weight-medium mb-1">Not built yet</div>
          <div class="text-caption text-medium-emphasis">
            Databases, cloud storage, data platforms, and RAG/vector stores (Section 5) need real live
            connectors — those are Phase 3+. This scanner only accepts uploaded evidence (Mode C).
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="8">
        <v-card>
          <div class="d-flex align-center justify-space-between pa-4 pb-2">
            <div class="text-subtitle-1 font-weight-medium">Scanned data assets</div>
          </div>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>File</th>
                <th>Rows</th>
                <th>PII found</th>
                <th>Linked AI system</th>
                <th>Scanned</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="dd.loading">
                <td colspan="5" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td>
              </tr>
              <tr v-else-if="!dd.assets.length">
                <td colspan="5" class="text-center py-6 text-medium-emphasis">No files scanned yet.</td>
              </tr>
              <tr
                v-for="a in dd.assets"
                :key="a.id"
                class="cursor-pointer"
                @click="$router.push({ name: 'data-asset-detail', params: { id: a.id } })"
              >
                <td class="font-weight-medium">{{ a.name }}</td>
                <td>
                  {{ a.rowCount ?? '—' }}
                  <v-chip v-if="a.scanComplete === false" size="x-small" variant="tonal" color="warning" class="ml-1">partial</v-chip>
                  <v-chip v-if="a.dataSourceType === 'CONNECTOR'" size="x-small" variant="tonal" class="ml-1">live DB</v-chip>
                </td>
                <td>
                  <span v-if="!a.findings.length" class="text-caption text-medium-emphasis">None detected</span>
                  <v-chip
                    v-for="f in a.findings"
                    :key="f.category"
                    size="small"
                    variant="tonal"
                    color="warning"
                    class="mr-1 mb-1"
                  >{{ f.category }}</v-chip>
                </td>
                <td>{{ a.aiSystem?.name || '—' }}</td>
                <td>{{ a.scannedAt ? new Date(a.scannedAt).toLocaleString() : '—' }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useDataDiscoveryStore } from '../stores/dataDiscovery';
import { useAiSystemsStore } from '../stores/aiSystems';

const dd = useDataDiscoveryStore();
const store = dd; // scanning state lives on the same store
const systemsStore = useAiSystemsStore();

const file = ref(null);
const aiSystemId = ref(null);
const relationship = ref('FEEDS');
const scanError = ref('');
const lastResult = ref(null);

const systemOptions = computed(() => systemsStore.items);

onMounted(async () => {
  await dd.fetchAssets();
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

async function runScan() {
  scanError.value = '';
  lastResult.value = null;
  const f = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!f) return;
  try {
    const result = await dd.scan(f, aiSystemId.value, aiSystemId.value ? relationship.value : undefined);
    lastResult.value = result;
    file.value = null;
    await dd.fetchAssets();
  } catch (e) {
    scanError.value = dd.error || 'Scan failed';
  }
}
</script>
