<template>
  <div class="reference-model-switch" :data-testid="`${testId}-model`">
    <NText depth="3" class="model-label" :title="label">
      {{ t('functionModel.currentModel', { model: label || t('model.select.noAvailableModels') }) }}
    </NText>
    <NButton text size="tiny" type="primary" :disabled="disabled" :data-testid="`${testId}-change-model`" @click="$emit('change')">
      {{ t('functionModel.changeModel') }}
    </NButton>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { defaultWindow, useEventListener } from '@vueuse/core'
import { NButton, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { decodeTextModelSelection } from '@prompt-optimizer/core'
import { useFunctionModelManager } from '../../composables/model/useFunctionModelManager'
import type { AppServices } from '../../types/services'

const props = defineProps<{ kind: 'image' | 'video'; testId: string; disabled: boolean }>()
defineEmits<{ change: [] }>()
const { t } = useI18n()
const services = inject<Ref<AppServices | null>>('services', ref(null))
const models = useFunctionModelManager(services)
const key = computed(() => props.kind === 'image' ? models.effectiveImageRecognitionModel.value : models.effectiveVideoUnderstandingModel.value)
const revision = ref(0)
const label = ref('')

// Editing the connection can change its display name or default model without changing its key.
useEventListener(defaultWindow, props.kind === 'image' ? 'image-workspace-refresh-text-models' : 'video-workspace-refresh-models', async () => {
  try {
    await models.refresh()
  } catch { /* Keep the last selection if settings could not be reloaded. */ }
  revision.value++
})

watch([key, revision], async ([selection], _, onCleanup) => {
  const decoded = decodeTextModelSelection(selection)
  label.value = decoded ? `${decoded.configId} · ${decoded.modelId}` : selection
  if (!selection) return
  let current = true
  onCleanup(() => { current = false })
  try {
    const config = await services.value?.modelManager?.getModel(selection)
    if (!current || !config) return
    const id = decoded?.modelId || config.modelMeta?.id || config.modelId
    const name = config.name || config.id
    label.value = id && name && name !== id ? `${name} · ${id}` : (id || name || selection)
  } catch { /* The selected identity is still visible if metadata is unavailable. */ }
}, { immediate: true })
</script>

<style scoped>
.reference-model-switch { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; font-size: 12px; }
.model-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
