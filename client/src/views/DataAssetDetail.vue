<template>
  <div v-if="dd.currentAsset">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" to="/data-discovery" class="mr-2" />
      <div>
        <div class="text-h6 font-weight-bold">{{ dd.currentAsset.name }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ dd.currentAsset.rowCount }} rows · {{ dd.currentAsset.columnCount }} columns ·
          scanned {{ new Date(dd.currentAsset.scannedAt).toLocaleString() }}
        </div>
      </div>
      <v-spacer />
      <v-chip v-if="dd.currentAsset.aiSystem" size="small" variant="tonal" color="primary">
        Linked to {{ dd.currentAsset.aiSystem.name }}
      </v-chip>
      <v-chip v-else size="small" variant="tonal" color="grey">Not linked to an AI system</v-chip>
    </div>

    <v-alert v-if="dd.currentAsset.scanComplete === false" type="warning" variant="tonal" density="compact" class="mb-4">
      Partial scan — only {{ dd.currentAsset.rowsScanned }} rows were read or indexed. Find Me in AI will never report
      "Not found" based on this asset; it can only report "Unknown".
    </v-alert>
    <v-alert v-if="dd.currentAsset.indexedAsHash" type="info" variant="tonal" density="compact" class="mb-4">
      Read live from a database. Personal-data values are stored only as keyed hashes, so no readable copy exists in Privault.
    </v-alert>
    <v-alert v-if="dd.valuesMasked" type="info" variant="tonal" density="compact" class="mb-4">
      Sample values below are masked for your role. Privacy Officer, DPO, and Governance Admin roles see unmasked values (Section 39).
    </v-alert>

    <v-row>
      <v-col cols="12" md="6">
        <v-card class="pa-4">
          <div class="text-subtitle-1 font-weight-medium mb-3">PII findings</div>
          <v-table density="comfortable" v-if="dd.currentAsset.findings.length">
            <thead>
              <tr><th>Column</th><th>Category</th><th>Method</th><th>Confidence</th><th>Matches</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in dd.currentAsset.findings" :key="f.id">
                <td>{{ f.column }}</td>
                <td><v-chip size="small" variant="tonal" color="warning">{{ f.category }}</v-chip></td>
                <td class="text-caption">{{ methodLabel(f.detectionMethod) }}</td>
                <td>{{ Math.round(f.confidence * 100) }}%</td>
                <td>{{ f.matchCount }} / {{ f.sampleRowsScanned }}</td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-body-2 text-medium-emphasis">No PII columns detected in this file.</div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="pa-4">
          <div class="text-subtitle-1 font-weight-medium mb-3">Sample values</div>
          <v-table density="comfortable" v-if="dd.sampleValues.length">
            <thead>
              <tr><th>Column</th><th>Category</th><th>Value</th><th>Row</th></tr>
            </thead>
            <tbody>
              <tr v-for="v in dd.sampleValues.slice(0, 30)" :key="v.id">
                <td>{{ v.column }}</td>
                <td class="text-caption">{{ v.category }}</td>
                <td class="font-weight-medium">{{ v.value }}</td>
                <td>{{ v.rowNumber }}</td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-body-2 text-medium-emphasis">No sample values captured.</div>
        </v-card>
      </v-col>
    </v-row>
  </div>
  <div v-else class="d-flex justify-center pa-10">
    <v-progress-circular indeterminate />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useDataDiscoveryStore } from '../stores/dataDiscovery';

const props = defineProps({ id: String });
const dd = useDataDiscoveryStore();

onMounted(() => dd.fetchAsset(props.id));

function methodLabel(m) {
  return { REGEX: 'Regex match', CHECKSUM: 'Checksum-verified', DICTIONARY: 'Column-name match' }[m] || m;
}
</script>
