<template>
  <div v-if="rag.currentKb">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" to="/rag-governance" class="mr-2" />
      <div>
        <div class="text-h6 font-weight-bold">{{ rag.currentKb.name }}</div>
        <div class="text-caption text-medium-emphasis">{{ rag.currentKb.description || 'No description' }}</div>
      </div>
    </div>

    <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
      {{ rag.currentKb.vectorStoreNote }}
    </v-alert>

    <v-row>
      <v-col cols="12" md="4">
        <v-card class="pa-5">
          <div class="text-subtitle-1 font-weight-medium mb-1">Ingest a document</div>
          <div class="text-caption text-medium-emphasis mb-4">
            .txt/.md files are chunked directly; .csv/.json are PII-scanned first (Phase 2 engine), then
            each row becomes one chunk.
          </div>
          <v-file-input v-model="file" label="Document" density="comfortable" class="mb-3" show-size />
          <v-alert v-if="ingestError" type="error" variant="tonal" density="compact" class="mb-3">{{ ingestError }}</v-alert>
          <v-btn block color="primary" :loading="rag.ingesting" :disabled="!file" @click="ingest">Ingest & chunk</v-btn>
          <v-alert v-if="lastResult" type="success" variant="tonal" density="compact" class="mt-4">
            Created {{ lastResult.chunkCount }} chunk(s). {{ lastResult.embeddingNote }}
          </v-alert>
        </v-card>
      </v-col>

      <v-col cols="12" md="8">
        <v-card>
          <div class="pa-4 pb-2 text-subtitle-1 font-weight-medium">Documents</div>
          <v-table density="comfortable">
            <thead><tr><th>File</th><th>Chunks</th><th>PII found</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!rag.currentKb.documents.length"><td colspan="4" class="text-center py-6 text-medium-emphasis">No documents ingested yet.</td></tr>
              <tr v-for="d in rag.currentKb.documents" :key="d.id">
                <td class="font-weight-medium">{{ d.dataAsset.name }}</td>
                <td>{{ d.chunkCount }}</td>
                <td>
                  <span v-if="!d.dataAsset.findings?.length" class="text-caption text-medium-emphasis">None detected / not applicable</span>
                  <v-chip v-for="f in d.dataAsset.findings" :key="f.category" size="small" variant="tonal" color="warning" class="mr-1 mb-1">{{ f.category }}</v-chip>
                </td>
                <td class="text-right"><v-btn size="small" variant="text" @click="viewChunks(d)">View chunks</v-btn></td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="chunksDialog" max-width="700" scrollable>
      <v-card>
        <v-card-title>Chunks — {{ activeDoc?.dataAsset?.name }}</v-card-title>
        <v-divider />
        <v-card-text style="max-height: 60vh">
          <div v-for="c in rag.currentChunks" :key="c.id" class="mb-3 pa-3" style="border: 1px solid #E1E4E8; border-radius: 8px">
            <div class="text-caption text-medium-emphasis mb-1">Chunk {{ c.chunkIndex + 1 }} · {{ c.charCount }} chars</div>
            <div class="text-body-2" style="white-space: pre-wrap">{{ c.content }}</div>
          </div>
        </v-card-text>
        <v-card-actions class="pa-4"><v-spacer /><v-btn variant="text" @click="chunksDialog = false">Close</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <div v-else class="d-flex justify-center pa-10"><v-progress-circular indeterminate /></div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRagStore } from '../stores/rag';

const props = defineProps({ id: String });
const rag = useRagStore();
const file = ref(null);
const ingestError = ref('');
const lastResult = ref(null);
const chunksDialog = ref(false);
const activeDoc = ref(null);

onMounted(() => rag.fetchKnowledgeBase(props.id));

async function ingest() {
  ingestError.value = '';
  lastResult.value = null;
  const f = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!f) return;
  try {
    const result = await rag.ingestDocument(props.id, f);
    lastResult.value = result;
    file.value = null;
    await rag.fetchKnowledgeBase(props.id);
  } catch (e) {
    ingestError.value = rag.error || 'Ingestion failed';
  }
}

async function viewChunks(doc) {
  activeDoc.value = doc;
  await rag.fetchChunks(props.id, doc.id);
  chunksDialog.value = true;
}
</script>
