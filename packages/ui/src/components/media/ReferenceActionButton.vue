<template>
  <ThemedTooltip :label="description" variant="rich" max-width="220px" white-space="normal" to="body" flip>
    <span class="reference-action-trigger">
      <NButton v-bind="$attrs" type="tertiary" size="small" ghost round class="reference-action-button">
        <template #icon><NIcon :size="16"><slot name="icon" /></NIcon></template>
        {{ label }}
      </NButton>
    </span>
  </ThemedTooltip>
</template>

<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui'
import ThemedTooltip from '../common/ThemedTooltip.vue'

defineOptions({ inheritAttrs: false })
defineProps<{ label: string; description: string }>()
</script>

<style scoped>
.reference-action-trigger { display: inline-flex; }
.reference-action-button { border-radius: 999px; font-weight: 500; }
</style>
