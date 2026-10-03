<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div class="text-caption text-medium-emphasis" style="max-width: 640px">
        Knowledge bases for RAG-enabled AI systems. Document ingestion runs real chunking and the same PII
        scan Phase 2 uses — embeddings and vector storage need a configured vector store, honestly marked
        below rather than faked.
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="dialog = true">New Knowledge Base</v-btn>
    </div>

    <v-row>
      <v-col cols="12" md="4" v-for="kb in rag.knowledgeBases" :key="kb.id">
        <v-card class="pa-4 cursor-pointer" height="100%" @click="$router.push({ name: 'rag-kb-detail', params: { id: kb.id } })">
          <div class="d-flex align-center justify-space-between mb-1">
            <div class="text-subtitle-1 font-weight-medium">{{ kb.name }}</div>
            <v-chip size="x-small" variant="tonal" :color="kb.vectorStoreStatus === 'CONNECTED' ? 'success' : 'grey'">
              {{ kb.vectorStoreStatus === 'CONNECTED' ? 'Vector store connected' : 'Vector store not configured' }}
            </v-chip>
          </div>
          <div class="text-caption text-medium-emphasis mb-2">{{ kb.description || 'No description' }}</div>
          <div class="text-caption">
            <span v-if="kb.aiSystem">Linked to {{ kb.aiSystem.name }}</span>
            <span v-else class="text-medium-emphasis">Not linked to an AI system</span>
          </div>
          <div class="text-caption text-medium-emphasis mt-2">{{ kb._count.documents }} document(s)</div>
        </v-card>
      </v-col>
      <v-col cols="12" v-if="!rag.loading && !rag.knowledgeBases.length">
        <v-card class="pa-6 text-center text-medium-emphasis">No knowledge bases yet.</v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="dialog" max-width="520">
      <v-card>
        <v-card-title>New Knowledge Base</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="Name *" class="mb-2" />
          <v-textarea v-model="form.description" label="Description" rows="2" class="mb-2" />
          <v-select v-model="form.aiSystemId" :items="systemsStore.items" item-title="name" item-value="id" label="Link to AI system" clearable />
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
import { useRagStore } from '../stores/rag';
import { useAiSystemsStore } from '../stores/aiSystems';

const rag = useRagStore();
const systemsStore = useAiSystemsStore();
const dialog = ref(false);
const saving = ref(false);
const form = reactive({ name: '', description: '', aiSystemId: null });

onMounted(async () => {
  await rag.fetchKnowledgeBases();
  if (!systemsStore.items.length) await systemsStore.fetchAll();
});

async function save() {
  saving.value = true;
  try {
    await rag.createKnowledgeBase({ ...form });
    dialog.value = false;
    Object.assign(form, { name: '', description: '', aiSystemId: null });
    await rag.fetchKnowledgeBases();
  } finally {
    saving.value = false;
  }
}
</script>
