<template>
  <v-chip size="small" :color="color" variant="tonal" class="font-weight-medium">
    {{ label }}
  </v-chip>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ status: { type: String, default: 'NOT_REQUIRED' } });

const map = {
  NOT_REQUIRED: { label: 'Not required', color: 'grey' },
  REQUIRED_NOT_STARTED: { label: 'Required — not started', color: 'error' },
  IN_PROGRESS: { label: 'In progress', color: 'warning' },
  COMPLETED: { label: 'Completed', color: 'success' },
  OVERDUE: { label: 'Overdue', color: 'error' },
};
const label = computed(() => (map[props.status] || map.NOT_REQUIRED).label);
const color = computed(() => (map[props.status] || map.NOT_REQUIRED).color);
</script>
