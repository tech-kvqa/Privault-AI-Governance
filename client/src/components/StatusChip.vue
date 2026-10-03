<template>
  <v-chip size="small" :color="color" variant="tonal" class="font-weight-medium">
    {{ label }}
  </v-chip>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ status: { type: String, default: 'PROPOSED' } });

const map = {
  PROPOSED: { label: 'Proposed', color: 'grey' },
  ASSESSMENT: { label: 'Assessment', color: 'info' },
  PENDING_APPROVAL: { label: 'Pending Approval', color: 'warning' },
  APPROVED: { label: 'Approved', color: 'secondary' },
  PRODUCTION: { label: 'Production', color: 'success' },
  SUSPENDED: { label: 'Suspended', color: 'error' },
  RETIRED: { label: 'Retired', color: 'grey' },
};
const label = computed(() => (map[props.status] || map.PROPOSED).label);
const color = computed(() => (map[props.status] || map.PROPOSED).color);
</script>
