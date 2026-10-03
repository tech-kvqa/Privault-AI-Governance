<template>
  <div class="mb-3">
    <div class="text-caption text-medium-emphasis mb-1">{{ label }}</div>
    <slot>
      <div class="text-body-2">{{ value || '—' }}</div>
    </slot>
  </div>
</template>

<script setup>
defineProps({ label: String, value: [String, Number, null] });
</script>
