<template>
  <div>
    <v-card class="pa-4 mb-4">
      <div class="text-subtitle-1 font-weight-medium mb-1">AI Data Map</div>
      <div class="text-caption text-medium-emphasis">
        Data assets (left) connected to the AI systems they feed (right), from real scans and links —
        not a layout guess. Unlinked items on either side are shown too: a gap in the map is information.
      </div>
    </v-card>

    <v-card class="pa-4" v-if="!dd.loading">
      <svg :width="svgWidth" :height="svgHeight" style="max-width: 100%">
        <line
          v-for="(e, i) in positionedEdges"
          :key="i"
          :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
          stroke="#B9C2CC" stroke-width="1.5"
        />
        <g v-for="n in dataAssetNodes" :key="n.id" @click="onNodeClick(n)" style="cursor: pointer">
          <rect :x="n.x" :y="n.y - 16" width="220" height="32" rx="8" fill="#FFFFFF" stroke="#2E7D6B" stroke-width="1.5" />
          <text :x="n.x + 12" :y="n.y + 5" font-size="12" font-family="IBM Plex Sans, system-ui, sans-serif" fill="#1B1F24">
            {{ truncate(n.label, 26) }}
          </text>
        </g>
        <g v-for="n in aiSystemNodes" :key="n.id" @click="onNodeClick(n)" style="cursor: pointer">
          <rect :x="n.x" :y="n.y - 16" width="220" height="32" rx="8" :fill="riskFill(n.meta?.riskClassification)" stroke="#1E3A5F" stroke-width="1.5" />
          <text :x="n.x + 12" :y="n.y + 5" font-size="12" font-family="IBM Plex Sans, system-ui, sans-serif" fill="#1B1F24">
            {{ truncate(n.label, 26) }}
          </text>
        </g>
      </svg>

      <div class="d-flex align-center mt-3" style="gap: 20px">
        <div class="d-flex align-center" style="gap: 6px">
          <div style="width:14px;height:14px;border-radius:4px;border:1.5px solid #2E7D6B;background:#fff"></div>
          <span class="text-caption">Data asset</span>
        </div>
        <div class="d-flex align-center" style="gap: 6px">
          <div style="width:14px;height:14px;border-radius:4px;border:1.5px solid #1E3A5F;background:#E8EEF4"></div>
          <span class="text-caption">AI system</span>
        </div>
      </div>
    </v-card>

    <div v-else class="d-flex justify-center pa-10"><v-progress-circular indeterminate /></div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useDataDiscoveryStore } from '../stores/dataDiscovery';

const dd = useDataDiscoveryStore();
const router = useRouter();

onMounted(() => dd.fetchMap());

const ROW_H = 56;
const TOP = 30;
const LEFT_X = 20;
const RIGHT_X = 460;

const dataAssetNodes = computed(() =>
  dd.mapNodes
    .filter((n) => n.type === 'DATA_ASSET')
    .map((n, i) => ({ ...n, x: LEFT_X, y: TOP + i * ROW_H }))
);
const aiSystemNodes = computed(() =>
  dd.mapNodes
    .filter((n) => n.type === 'AI_SYSTEM')
    .map((n, i) => ({ ...n, x: RIGHT_X, y: TOP + i * ROW_H }))
);

const svgWidth = computed(() => RIGHT_X + 260);
const svgHeight = computed(() => TOP + Math.max(dataAssetNodes.value.length, aiSystemNodes.value.length) * ROW_H + 20);

const positionedEdges = computed(() => {
  const byId = {};
  [...dataAssetNodes.value, ...aiSystemNodes.value].forEach((n) => (byId[n.id] = n));
  return dd.mapEdges
    .map((e) => {
      const s = byId[e.source];
      const t = byId[e.target];
      if (!s || !t) return null;
      return { x1: s.x + 220, y1: s.y, x2: t.x, y2: t.y };
    })
    .filter(Boolean);
});

function riskFill(risk) {
  return { HIGH: '#FBE9E7', CRITICAL: '#FBE9E7', MEDIUM: '#FBEFE2', LOW: '#E7F3E8' }[risk] || '#E8EEF4';
}
function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function onNodeClick(n) {
  if (n.type === 'AI_SYSTEM') router.push({ name: 'ai-system-profile', params: { id: n.refId } });
  else router.push({ name: 'data-asset-detail', params: { id: n.refId } });
}
</script>
