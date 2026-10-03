<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 720px">
        Live connectors read your systems directly. The PostgreSQL connector opens <strong>read-only</strong> sessions
        (enforced by Postgres itself), reads the first rows of each table it can see, and stores personal data only as
        keyed hashes — never in clear. A connector becomes Connected only after a real connection test succeeds.
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Add PostgreSQL connector</v-btn>
    </div>

    <v-alert v-if="actionError" type="error" variant="tonal" density="compact" class="mb-3" closable @click:close="actionError = ''">{{ actionError }}</v-alert>
    <v-alert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" variant="tonal" density="compact" class="mb-3" closable @click:close="testResult = null">
      <template v-if="testResult.ok">
        Connected as <strong>{{ testResult.info.user }}</strong> to <strong>{{ testResult.info.database }}</strong> ({{ testResult.info.serverVersion }}).
        Read-only session: {{ testResult.info.readOnlySession ? 'yes' : 'NO' }}.
        <div v-for="w in testResult.info.warnings" :key="w" class="text-caption mt-1">⚠ {{ w }}</div>
      </template>
      <template v-else>Connection failed: {{ testResult.error }}</template>
    </v-alert>

    <v-card>
      <v-table density="comfortable">
        <thead><tr><th>Name</th><th>Type</th><th>Target</th><th>Status</th><th>Last test</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!store.items.length"><td colspan="6" class="text-center py-6 text-medium-emphasis">No connectors yet.</td></tr>
          <tr v-for="c in store.items" :key="c.id">
            <td class="font-weight-medium">{{ c.name }}</td>
            <td class="text-caption">{{ typeLabel(c) }}</td>
            <td class="text-caption">
              <span v-if="c.config?.host">{{ c.config.user }}@{{ c.config.host }}:{{ c.config.port }}/{{ c.config.database }}<div class="text-medium-emphasis">TLS: {{ c.config.sslmode }}</div></span>
              <span v-else class="text-medium-emphasis">—</span>
            </td>
            <td>
              <v-chip size="small" variant="tonal" :color="c.status === 'CONNECTED' ? 'success' : 'grey'">{{ c.status === 'CONNECTED' ? 'Connected' : 'Not configured' }}</v-chip>
              <div v-if="c.lastError" class="text-caption text-error mt-1">{{ c.lastError }}</div>
              <div v-if="!isPg(c) && c.type !== 'FILE_UPLOAD'" class="text-caption text-medium-emphasis mt-1">Integration required — not implemented</div>
            </td>
            <td class="text-caption">{{ c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleString() : '—' }}</td>
            <td class="text-right" style="white-space: nowrap">
              <template v-if="isPg(c)">
                <v-btn size="small" variant="text" :loading="busy === 't' + c.id" @click="test(c)">Test</v-btn>
                <v-btn size="small" variant="tonal" color="primary" :disabled="c.status !== 'CONNECTED'" @click="openScan(c)">Scan</v-btn>
                <v-btn size="small" variant="text" @click="openRotate(c)">Rotate password</v-btn>
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="createDialog" max-width="560">
      <v-card>
        <v-card-title>Add PostgreSQL connector</v-card-title>
        <v-card-text>
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
            Use a dedicated role with <strong>SELECT only</strong> on the schemas to scan — Privault warns if the role is a
            superuser. The password is encrypted at rest and never shown again.
          </v-alert>
          <v-row>
            <v-col cols="12"><v-text-field v-model="form.name" label="Connector name *" /></v-col>
            <v-col cols="12" md="8"><v-text-field v-model="form.host" label="Host *" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model.number="form.port" type="number" label="Port" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.database" label="Database *" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.user" label="User *" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.password" type="password" label="Password *" autocomplete="new-password" /></v-col>
            <v-col cols="12" md="6">
              <v-select v-model="form.sslmode" :items="sslModes" item-title="label" item-value="value" label="TLS" />
            </v-col>
            <v-col cols="12" md="6"><v-combobox v-model="form.schemas" label="Only these schemas (optional)" multiple chips closable-chips /></v-col>
          </v-row>
          <v-alert v-if="createError" type="error" variant="tonal" density="compact">{{ createError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="createDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="creating" :disabled="!form.name || !form.host || !form.database || !form.user || !form.password" @click="create">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="scanDialog" max-width="820" scrollable>
      <v-card>
        <v-card-title>Scan {{ scanTarget?.name }}</v-card-title>
        <v-card-text>
          <div v-if="!scanResult">
            <v-select v-model="scanForm.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="Link tables that hold personal data to an AI system (optional)" clearable class="mb-2" />
            <v-select v-if="scanForm.aiSystemId" v-model="scanForm.relationship" :items="['FEEDS', 'TRAINED_ON', 'USED_IN_RAG']" label="Relationship" class="mb-2" />
            <v-text-field v-model.number="scanForm.sampleRows" type="number" min="1" max="2000" label="Rows to read per table (max 2000)"
              hint="Reads the FIRST rows of each table (not a random sample). Larger tables are reported as incomplete." persistent-hint class="mb-2" />
            <v-alert v-if="scanError" type="error" variant="tonal" density="compact" class="mt-3">{{ scanError }}</v-alert>
          </div>
          <div v-else>
            <v-alert type="success" variant="tonal" density="compact" class="mb-3">
              {{ scanResult.tablesScanned }} of {{ scanResult.tablesFound }} tables scanned · {{ scanResult.tablesWithPii }} contain personal data ·
              {{ scanResult.tablesComplete }} fully scanned · <strong>{{ scanResult.tablesIncomplete }} only sampled</strong>
            </v-alert>
            <v-alert v-if="scanResult.tablesTruncated" type="warning" variant="tonal" density="compact" class="mb-3">Table limit reached — some tables were not scanned.</v-alert>
            <v-table density="compact">
              <thead><tr><th>Table</th><th>Rows read</th><th>Est. rows</th><th>Coverage</th><th>Personal data found</th></tr></thead>
              <tbody>
                <tr v-for="t in scanResult.tables" :key="t.name">
                  <td class="font-weight-medium">{{ t.name }}</td>
                  <td>{{ t.rowsScanned }}</td>
                  <td>{{ t.estimatedRows ?? '—' }}</td>
                  <td><v-chip size="x-small" variant="tonal" :color="t.complete ? 'success' : 'warning'">{{ t.complete ? 'Complete' : 'Sampled' }}</v-chip></td>
                  <td>
                    <v-chip v-for="c in t.piiCategories" :key="c" size="x-small" variant="tonal" color="warning" class="mr-1">{{ c }}</v-chip>
                    <span v-if="!t.piiCategories.length" class="text-caption text-medium-emphasis">none</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
            <div v-for="e in scanResult.errors" :key="e.table" class="text-caption text-error mt-2">{{ e.table }}: {{ e.error }}</div>
            <div class="text-caption text-medium-emphasis mt-3">{{ scanResult.note }}</div>
          </div>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="scanDialog = false">{{ scanResult ? 'Close' : 'Cancel' }}</v-btn>
          <v-btn v-if="!scanResult" color="primary" :loading="scanning" @click="runScan">Start scan</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rotateDialog" max-width="440">
      <v-card>
        <v-card-title>Rotate password — {{ rotateTarget?.name }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="newPassword" type="password" label="New password" autocomplete="new-password" />
          <div class="text-caption text-medium-emphasis">The connector returns to "Not configured" until you re-test it.</div>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="rotateDialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!newPassword" @click="rotate">Replace</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useConnectorsStore } from '../stores/connectors';
import { useAiSystemsStore } from '../stores/aiSystems';

const store = useConnectorsStore();
const systemsStore = useAiSystemsStore();

const sslModes = [
  { value: 'verify-full', label: 'Encrypted + verify server certificate (recommended)' },
  { value: 'require', label: 'Encrypted, certificate NOT verified' },
  { value: 'disable', label: 'No encryption (local testing only)' },
];
const createDialog = ref(false);
const creating = ref(false);
const createError = ref('');
const form = reactive({ name: '', host: '', port: 5432, database: '', user: '', password: '', sslmode: 'verify-full', schemas: [] });

const busy = ref(null);
const testResult = ref(null);
const actionError = ref('');

const scanDialog = ref(false);
const scanTarget = ref(null);
const scanForm = reactive({ aiSystemId: null, relationship: 'FEEDS', sampleRows: 1000 });
const scanning = ref(false);
const scanResult = ref(null);
const scanError = ref('');

const rotateDialog = ref(false);
const rotateTarget = ref(null);
const newPassword = ref('');

onMounted(async () => {
  await store.fetch();
  if (!systemsStore.items.length) systemsStore.fetchAll().catch(() => {});
});

const isPg = (c) => c.type === 'DATABASE' && c.config?.engine === 'postgres';
const typeLabel = (c) => (isPg(c) ? 'PostgreSQL' : c.type.replaceAll('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()));

function openCreate() {
  createError.value = '';
  Object.assign(form, { name: '', host: '', port: 5432, database: '', user: '', password: '', sslmode: 'verify-full', schemas: [] });
  createDialog.value = true;
}
async function create() {
  creating.value = true; createError.value = '';
  try {
    await store.create({
      name: form.name, type: 'DATABASE',
      config: { host: form.host, port: form.port, database: form.database, user: form.user, password: form.password, sslmode: form.sslmode, schemas: form.schemas.length ? form.schemas : undefined },
    });
    createDialog.value = false;
    await store.fetch();
  } catch (e) {
    createError.value = e.response?.data?.error || 'Failed to create connector';
  } finally {
    creating.value = false;
  }
}

async function test(c) {
  busy.value = 't' + c.id; testResult.value = null; actionError.value = '';
  try { testResult.value = await store.test(c.id); await store.fetch(); }
  catch (e) { actionError.value = e.response?.data?.error || 'Test failed'; }
  finally { busy.value = null; }
}

function openScan(c) { scanTarget.value = c; scanResult.value = null; scanError.value = ''; Object.assign(scanForm, { aiSystemId: null, relationship: 'FEEDS', sampleRows: 1000 }); scanDialog.value = true; }
async function runScan() {
  scanning.value = true; scanError.value = '';
  try {
    scanResult.value = await store.scan(scanTarget.value.id, {
      aiSystemId: scanForm.aiSystemId || undefined, relationship: scanForm.aiSystemId ? scanForm.relationship : undefined, sampleRows: scanForm.sampleRows,
    });
  } catch (e) {
    scanError.value = e.response?.data?.error || 'Scan failed';
  } finally {
    scanning.value = false;
  }
}

function openRotate(c) { rotateTarget.value = c; newPassword.value = ''; rotateDialog.value = true; }
async function rotate() {
  await store.rotate(rotateTarget.value.id, newPassword.value);
  rotateDialog.value = false;
  await store.fetch();
}
</script>
