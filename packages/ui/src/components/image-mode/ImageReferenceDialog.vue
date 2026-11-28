<template>
  <AdaptiveModal
    show preset="card" presentation="picker" :title="title"
    :style="{ width: 'min(520px, 94vw)' }" :bordered="false" closable
    :mask-closable="!busy" data-testid="image-reference-dialog"
    @paste="paste" @update:show="visible => { if (!visible) close() }"
  >
    <NSpace vertical :size="14">
      <NText depth="2">{{ description }}</NText>
      <ReferenceModelSwitch kind="image" test-id="image-reference" :disabled="busy" @change="$emit('configure')" />
      <ReferenceImagePicker
        class="reference-image-input" :items="selection ? [selection.item] : []"
        :multiple="false" :max="1" replaceable :disabled="busy" :loading="preparing"
        :upload-text="t('imageWorkspace.referenceImage.pickHint')" preview-fit="contain"
        upload-test-id="image-reference-picker" upload-card-test-id="image-reference-choose"
        preview-test-id="image-reference-preview" replace-test-id="image-reference-replace"
        @select-files="selectFiles" @remove="clearSelection"
      />
      <NText v-if="busy" depth="2" role="status">{{ t('imageWorkspace.referenceImage.analyzing') }}</NText>
      <NAlert v-if="error" type="error" role="alert">{{ error }}</NAlert>
    </NSpace>
    <template #action>
      <NSpace justify="end">
        <NButton data-testid="image-reference-cancel" @click="close">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="busy" :disabled="!selection || preparing || busy" data-testid="image-reference-submit" @click="generate">
          {{ t('imageWorkspace.referenceImage.generate') }}
        </NButton>
      </NSpace>
    </template>
  </AdaptiveModal>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import { NAlert, NButton, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { ImageInputRef } from '@prompt-optimizer/core'
import { useImageInputPreparation } from '../../composables/image/useImageInputPreparation'
import type { ReferenceActionKind } from '../../composables/image/useReferenceImageActions'
import { useFunctionModelManager } from '../../composables/model/useFunctionModelManager'
import { useToast } from '../../composables/ui/useToast'
import { resolveReferencePromptPreview, type ReferencePromptPreview } from '../../services/ImageStyleExtractor'
import { getI18nErrorMessage } from '../../utils/error'
import type { AppServices } from '../../types/services'
import AdaptiveModal from '../common/AdaptiveModal.vue'
import ReferenceModelSwitch from '../media/ReferenceModelSwitch.vue'
import ReferenceImagePicker, { type ReferenceImageItem } from '../media/ReferenceImagePicker.vue'

const props = defineProps<{ kind: ReferenceActionKind; originalPrompt: string }>()
const emit = defineEmits<{
  close: []
  configure: []
  busy: [value: boolean]
  apply: [preview: ReferencePromptPreview, imageSrc: string]
}>()
const { t } = useI18n()
const toast = useToast()
const services = inject<Ref<AppServices | null>>('services', ref(null))
const models = useFunctionModelManager(services)
const { prepareInputRefs } = useImageInputPreparation()
const title = computed(() => t(props.kind === 'replicate' ? 'imageWorkspace.referenceImage.replicateAction' : 'imageWorkspace.referenceImage.styleLearnAction'))
const description = computed(() => t(props.kind === 'replicate' ? 'imageWorkspace.referenceImage.replicateActionDescription' : 'imageWorkspace.referenceImage.styleLearnActionDescription'))
const selection = shallowRef<{ input: ImageInputRef; item: ReferenceImageItem } | null>(null)
const preparing = ref(false)
const busy = ref(false)
const error = ref('')
let active = true

function clearSelection() {
  selection.value = null
  error.value = ''
}

async function selectFiles([file]: File[]) {
  if (!file || preparing.value || busy.value) return
  preparing.value = true
  error.value = ''
  try {
    const [input] = await prepareInputRefs([file], {}, false) || []
    if (!active || !input) return
    const src = `data:${input.mimeType || 'image/png'};base64,${input.b64}`
    selection.value = { input, item: { id: file.name, label: file.name, src } }
  } catch (cause) {
    if (active) error.value = getI18nErrorMessage(cause, t('imageWorkspace.upload.processingFailed'))
  } finally {
    if (active) preparing.value = false
  }
}

function paste(event: ClipboardEvent) {
  const image = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'))
  if (!image || busy.value || preparing.value) return
  event.preventDefault()
  void selectFiles([image])
}

function close() {
  active = false
  emit('close')
}
onBeforeUnmount(() => { active = false })

async function generate() {
  const selected = selection.value
  if (!selected || preparing.value || busy.value) return
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    await models.initialize()
    if (!active) return
    const key = models.effectiveImageRecognitionModel.value
    const config = key ? await services.value?.modelManager?.getModel(key) : null
    if (!active) return
    if (!config) {
      toast.info(t('functionModel.noImageRecognitionModel'))
      emit('configure')
      return
    }
    const preview = await resolveReferencePromptPreview({
      mode: props.kind === 'style-learn' ? 'migrate' : 'replicate',
      originalPrompt: props.originalPrompt,
      referenceMode: 'text2image',
      modelConfig: config,
      templateManager: services.value?.templateManager,
      imageB64: selected.input.b64,
      mimeType: selected.input.mimeType || 'image/png',
    })
    if (active) emit('apply', preview, selected.item.src)
  } catch (cause) {
    if (active) error.value = getI18nErrorMessage(cause, t('imageWorkspace.input.extractFailed'))
  } finally {
    if (active) {
      busy.value = false
      emit('busy', false)
    }
  }
}
</script>

<style scoped>
.reference-image-input :deep(.image-upload-card--empty) { min-height: 148px; flex-direction: column; }
.reference-image-input :deep(.image-card) { box-sizing: border-box; width: 100%; }
.reference-image-input :deep(.image-card__preview-wrap) { height: min(210px, 28dvh); aspect-ratio: auto; }
</style>
