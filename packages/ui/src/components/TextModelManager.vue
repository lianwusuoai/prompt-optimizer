<template>
  <div class="text-model-manager">
    <ChatGPTSubscriptionConnection ref="subscription" :active="active" :has-connection="!!subscriptionModel" @updated="refreshSubscriptionModels"
      @availability="onSubscriptionAvailability" />
    <LocalServiceDiscovery :active="active && modelsReady" :models="manager.models.value"
      :disabled="preparingLocalService || showEditModal" @select="handleLocalService" />
    <TextModelList
      :models="visibleModels"
      :subscription-email="subscription?.account?.state.email"
      :is-testing-connection-for="isTestingConnectionFor"
      v-if="visibleModels.length || !hasSubscription"
      @test="handleTestConnection"
      @edit="handleEditModel"
      @clone="handleCloneModel"
      @enable="handleEnableModel"
      @disable="handleDisableModel"
      @delete="handleDeleteModel"
    />

    <TextModelEditModal
      :show="showEditModal"
      @update:show="updateEditModalVisibility"
      @saved="handleModelUpdated"
      @subscription="openSubscription"
    >
      <template #subscription-provider>
        <ChatGPTSubscriptionAccount v-if="subscription?.account" v-bind="subscription.account" @action="subscription.onAccountAction" />
      </template>
    </TextModelEditModal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, provide, ref, h, watch, computed } from 'vue'

import { useI18n } from 'vue-i18n'
import { CHATGPT_SUBSCRIPTION_PROVIDER, isRunningInElectron } from '@prompt-optimizer/core'
import LocalServiceDiscovery from './LocalServiceDiscovery.vue'
import ChatGPTSubscriptionConnection from './ChatGPTSubscriptionConnection.vue'
import ChatGPTSubscriptionAccount from './ChatGPTSubscriptionAccount.vue'
import { isChromeBuiltInPlaceholder, type DiscoveredLocalService } from '../utils/local-model-discovery'
import { useTextModelManager } from '../composables/model/useTextModelManager'
import TextModelList from './TextModelList.vue'
import TextModelEditModal from './TextModelEditModal.vue'
import { useDialog } from 'naive-ui'
import { useToast } from '../composables/ui/useToast'
import { useConfirmDialog } from '../composables/ui/useConfirmDialog'
import { getProviderDisplayName } from '../utils/provider-display'

const emit = defineEmits(['modelsUpdated', 'subscriptionAvailability'])
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: false })
const { t } = useI18n()
const toast = useToast()
const dialog = useDialog()
const confirmDialog = useConfirmDialog()
const manager = useTextModelManager()
provide('textModelManager', manager)
const subscription = ref<InstanceType<typeof ChatGPTSubscriptionConnection>>()
const hasSubscription = ref(false)
function onSubscriptionAvailability(connected: boolean) {
  hasSubscription.value = connected
  emit('subscriptionAvailability', connected)
}
const subscriptionModel = computed(() => {
  const account = subscription.value?.account?.state
  if (account?.status !== 'connected' || !account.connectionRef) return undefined
  return manager.models.value.find(model => model.providerId === CHATGPT_SUBSCRIPTION_PROVIDER
    && model.connectionConfig.subscriptionRef === account.connectionRef)
})
const visibleModels = computed(() => manager.models.value.filter(model => !isChromeBuiltInPlaceholder(model)
  && (model.providerId !== CHATGPT_SUBSCRIPTION_PROVIDER || model === subscriptionModel.value)))

const showEditModal = ref(false)
const modelsReady = ref(false)
const preparingLocalService = ref(false)
let localDraftGeneration = 0
watch(() => props.active, active => {
  if (!active) {
    localDraftGeneration++
    manager.cancelLocalModelRequest()
  }
})
onBeforeUnmount(() => {
  localDraftGeneration++
  manager.cancelLocalModelRequest()
})
const handleLocalService = async (service: DiscoveredLocalService) => {
  if (preparingLocalService.value || showEditModal.value || !props.active) return
  preparingLocalService.value = true
  const current = ++localDraftGeneration
  try {
    const prepared = await manager.prepareForLocalService(service)
    if (!prepared || current !== localDraftGeneration || !props.active) return
    editingModelId.value = null
    showEditModal.value = true
  } catch {
    if (current === localDraftGeneration && props.active) toast.error(t('modelManager.loadFailed'))
  } finally {
    preparingLocalService.value = false
  }
}
const editingModelId = ref<string | null>(null)
const isTestingConnectionFor = (id: string) => !!manager.testingConnections.value[id]
async function refreshSubscriptionModels() {
  await manager.loadModels()
  if (showEditModal.value && manager.form.value.providerId === CHATGPT_SUBSCRIPTION_PROVIDER) {
    if (subscriptionModel.value && subscriptionModel.value.id === editingModelId.value) {
      manager.setSubscriptionCatalog(subscriptionModel.value)
    } else {
      updateEditModalVisibility(false)
      manager.resetFormState()
    }
  }
  emit('modelsUpdated')
}
const handleModelUpdated = async (id?: string) => {
  await manager.loadModels()
  const targetId = id || manager.models.value[0]?.id
  if (targetId) {
    emit('modelsUpdated', targetId)
  }

  // 保存成功后关闭模态框并重置表单状态
  showEditModal.value = false
  editingModelId.value = null
  manager.resetFormState()
}

const handleTestConnection = async (id: string) => {
  const runTest = async () => {
    await manager.testConfigConnection(id)
  }

  if (!isRunningInElectron()) {
    const model = manager.models.value.find(m => m.id === id)
    if (model) {
      const isCorsRestricted = !!model.providerMeta?.corsRestricted
      if (isCorsRestricted) {
        const providerName = getProviderDisplayName(model.providerMeta, t, 'Unknown Provider')
        dialog.warning({
          title: t('modelManager.corsRestrictedTag'),
          content: () => h('div', { style: 'white-space: pre-line;' }, t('modelManager.corsRestrictedConfirm', { provider: providerName })),
          positiveText: t('common.confirm'),
          negativeText: t('common.cancel'),
          // Don't block dialog close while the async test runs.
          onPositiveClick: () => {
            void runTest()
          }
        })
        return
      }
    }
  }
  await runTest()
}

const handleEditModel = async (id: string) => {
  // 如果已经在编辑同一个模型且模态框已经打开，直接返回
  if (editingModelId.value === id && showEditModal.value === true) {
    return
  }

  // 如果切换到不同的模型，重置表单状态
  if (editingModelId.value && editingModelId.value !== id) {
    manager.resetFormState()
  }

  // 准备编辑模式（总是会执行，因为我们需要确保状态正确）
  await manager.prepareForEdit(id, true)
  editingModelId.value = id
  showEditModal.value = true
}

const updateEditModalVisibility = (value: boolean) => {
  showEditModal.value = value
  // 当模态框关闭时，重置编辑状态但不重置表单数据
  if (!value) {
    editingModelId.value = null
    manager.cancelLocalModelRequest()
  }
}

const handleCloneModel = async (id: string) => {
  try {
    await manager.prepareForClone(id)
    showEditModal.value = true
    editingModelId.value = null
  } catch {
    // prepareForClone already handles user-facing errors
  }
}

const handleEnableModel = async (id: string) => {
  await manager.enableModel(id)
  emit('modelsUpdated', id)
}

const handleDisableModel = async (id: string) => {
  await manager.disableModel(id)
  emit('modelsUpdated', id)
}

const handleDeleteModel = async (id: string) => {
  const confirmed = await confirmDialog.warning({
    title: t('common.warning'),
    content: t('modelManager.deleteConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
  })
  if (!confirmed) return

  await manager.deleteModel(id)
  const firstId = manager.models.value[0]?.id
  emit('modelsUpdated', firstId)
}

const openAddModal = async () => {
  await manager.prepareForCreate()
  editingModelId.value = null
  showEditModal.value = true
}

function openSubscription() {
  if (subscriptionModel.value) {
    void handleEditModel(subscriptionModel.value.id)
    return
  }
  showEditModal.value = false
  subscription.value?.open()
}

defineExpose({
  openAddModal, openSubscription,
  openEditModal: handleEditModel,
  refresh: manager.loadModels
})

onMounted(async () => {
  await manager.loadProviders()
  await manager.loadModels()
  modelsReady.value = true
  const firstId = manager.models.value[0]?.id
  if (firstId) {
    emit('modelsUpdated', firstId)
  }
})
</script>

<style scoped>
.text-model-manager {
  width: 100%;
}
</style>
