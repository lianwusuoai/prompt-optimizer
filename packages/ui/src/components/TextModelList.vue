<template>
  <ModelConfigList kind="text" :models="rows" :is-testing-connection-for="isTestingConnectionFor"
    @test="emit('test', $event)" @edit="emit('edit', $event)" @clone="emit('clone', $event)"
    @enable="emit('enable', $event)" @disable="emit('disable', $event)" @delete="emit('delete', $event)" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHATGPT_SUBSCRIPTION_PROVIDER, isRunningInElectron, type TextModelConfig } from '@prompt-optimizer/core'
import ModelConfigList, { type ModelConfigListItem } from './common/ModelConfigList.vue'
import { getProviderDisplayName, getTextModelConfigDisplayName } from '../utils/provider-display'

const props = withDefaults(defineProps<{
  models?: TextModelConfig[]
  subscriptionEmail?: string
  isTestingConnectionFor: (id: string) => boolean
}>(), { models: () => [] })
const emit = defineEmits(['test', 'edit', 'clone', 'enable', 'disable', 'delete'])
const { t } = useI18n()
const desktop = isRunningInElectron()
const rows = computed<ModelConfigListItem[]>(() => props.models.map(config => {
  const tags: ModelConfigListItem['tags'] = []
  const subscription = config.providerId === CHATGPT_SUBSCRIPTION_PROVIDER
  if (subscription && props.subscriptionEmail) tags.push({ label: props.subscriptionEmail, type: 'default' })
  if (config.providerMeta?.corsRestricted && !desktop) tags.push({ label: t('modelManager.corsRestrictedTag'), type: 'error' })
  if (config.modelMeta?.capabilities?.supportsTools) tags.push({ label: t('modelManager.capabilities.tools'), type: 'success' })
  if (config.modelMeta?.capabilities?.supportsReasoning) tags.push({ label: t('modelManager.capabilities.reasoning'), type: 'warning' })
  return {
    id: config.id, name: getTextModelConfigDisplayName(config, t), provider: getProviderDisplayName(config.providerMeta, t),
    model: config.modelMeta?.name || config.modelMeta?.id || '', modelId: config.modelMeta?.id, enabled: config.enabled,
    deletable: !subscription, clonable: !subscription, tags,
  }
}))
</script>
