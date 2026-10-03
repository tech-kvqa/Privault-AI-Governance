<template>
  <v-chip size="small" :color="color" variant="flat" class="font-weight-medium">
    {{ label }}
  </v-chip>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ risk: { type: String, default: 'UNCLASSIFIED' } });

const map = {
  UNCLASSIFIED: { label: 'Unclassified', color: 'grey' },
  LOW: { label: 'Low', color: 'success' },
  MEDIUM: { label: 'Medium', color: 'warning' },
  HIGH: { label: 'High', color: 'error' },
  CRITICAL: { label: 'Critical', color: 'error' },
};
const label = computed(() => (map[props.risk] || map.UNCLASSIFIED).label);
const color = computed(() => (map[props.risk] || map.UNCLASSIFIED).color);
</script>
