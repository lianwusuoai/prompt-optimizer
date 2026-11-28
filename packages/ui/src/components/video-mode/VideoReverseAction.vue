<template>
  <ReferenceActionButton
    :label="t('video.reverse.action')" :description="t('video.reverse.hint')"
    :disabled="disabled || !services"
    data-testid="video-reverse-open" @click="show = true"
  >
    <template #icon><Clapperboard /></template>
  </ReferenceActionButton>

  <AdaptiveModal
    :show="show"
    preset="card"
    presentation="picker"
    :title="t('video.reverse.title')"
    :style="{ width: 'min(520px, 94vw)' }"
    :bordered="false"
    closable
    :mask-closable="!busy"
    close-on-esc
    @update:show="visible => { if (!visible) close() }"
  >
    <NSpace vertical :size="14">
      <template v-if="!pendingResult">
        <NText depth="2" class="video-reverse-hint">{{ t('video.reverse.hint') }}</NText>

        <div class="video-reverse-toolbar">
          <NRadioGroup v-model:value="sourceKind" size="small" :disabled="busy" :aria-label="t('video.reverse.title')">
            <NRadioButton value="file" data-testid="video-reverse-file-mode">{{ t('video.reverse.file') }}</NRadioButton>
            <NRadioButton value="url" data-testid="video-reverse-url-mode">{{ t('video.reverse.url') }}</NRadioButton>
          </NRadioGroup>

          <ReferenceModelSwitch v-if="show" kind="video" test-id="video-reverse" :disabled="busy" @change="openModels('function')" />
        </div>

        <NInput
          v-if="sourceKind === 'url'"
          ref="urlInput"
          v-model:value="url"
          clearable
          placeholder="https://…"
          :disabled="busy"
          :input-props="{ inputmode: 'url', 'aria-label': t('video.reverse.url') }"
          data-testid="video-reverse-url"
          @keydown.enter.prevent="onUrlEnter"
        />

        <div
          v-else
          class="video-drop-surface"
          :class="{ 'video-drop-surface--active': externalDragOver, 'video-drop-surface--disabled': busy }"
          data-testid="video-reverse-dropzone"
          @dragenter="onDragEnter"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <input
            ref="picker"
            type="file"
            accept="video/*"
            hidden
            data-testid="video-reverse-file"
            @change="selectFile"
          />

          <button
            v-if="!file"
            type="button"
            class="video-drop-empty"
            :disabled="busy"
            data-testid="video-reverse-choose"
            @click="triggerPicker"
          >
            <Upload class="video-drop-empty__icon" :size="24" aria-hidden="true" />
            <span class="video-drop-empty__title">
              {{ compact ? t('video.reverse.dropTextCompact') : t('video.reverse.dropText') }}
            </span>
            <span class="video-drop-empty__hint">{{ t('video.reverse.formatsHint') }}</span>
          </button>

          <div v-else class="video-file-card" data-testid="video-reverse-preview-card">
            <div v-if="previewUrl" class="video-file-card__player-wrap">
              <video
                :key="previewUrl"
                :src="previewUrl"
                controls
                playsinline
                preload="metadata"
                class="video-file-card__player"
                :class="{ 'video-file-card__player--compact': compact }"
                @loadedmetadata="onLoadedMetadata"
              />
            </div>

            <div class="video-file-card__meta">
              <div class="video-file-card__info">
                <Film class="video-file-card__icon" :size="15" aria-hidden="true" />
                <NText strong class="video-filename" :title="file.name">{{ file.name }}</NText>
                <NText depth="3" class="video-file-card__stats">{{ fileStats }}</NText>
              </div>
              <div class="video-file-card__actions">
                <NButton text size="tiny" type="primary" :disabled="busy" data-testid="video-reverse-replace" @click="triggerPicker">
                  {{ t('video.reverse.replaceFile') }}
                </NButton>
                <NButton
                  quaternary
                  circle
                  size="tiny"
                  :disabled="busy"
                  :aria-label="t('video.reverse.removeFile')"
                  :title="t('video.reverse.removeFile')"
                  data-testid="video-reverse-remove"
                  @click="clearFile"
                >
                  <template #icon><X :size="14" /></template>
                </NButton>
              </div>
            </div>
          </div>

          <div v-if="externalDragOver" class="video-drop-overlay" role="status">
            <Upload :size="22" aria-hidden="true" />
            <span>{{ t('video.reverse.dropActive') }}</span>
          </div>
        </div>

        <NAlert v-if="isLargeFile" type="warning" :show-icon="false" data-testid="video-reverse-size-warning">
          {{ t('video.reverse.largeFileHint') }}
        </NAlert>

        <div v-if="busy" class="video-reverse-status" role="status" data-testid="video-reverse-analyzing">
          <NSpin size="small" />
          <NText depth="2">{{ t('video.reverse.analyzing') }}</NText>
        </div>
      </template>

      <template v-else>
        <NText>{{ t('video.reverse.changed') }}</NText>
        <NInput type="textarea" :value="pendingResult" readonly :autosize="{ minRows: 3, maxRows: 8 }" />
      </template>

      <NAlert v-if="error" type="error" role="alert" data-testid="video-reverse-error">{{ error }}</NAlert>
    </NSpace>

    <template #action>
      <NSpace justify="end">
        <NButton data-testid="video-reverse-cancel" @click="close">{{ t('common.cancel') }}</NButton>
        <NButton v-if="pendingResult" type="primary" @click="apply(pendingResult)">{{ t('video.reverse.apply') }}</NButton>
        <NButton
          v-else
          type="primary"
          :loading="busy"
          :disabled="!source || busy"
          data-testid="video-reverse-generate"
          @click="generate"
        >
          {{ t('video.reverse.generate') }}
        </NButton>
      </NSpace>
    </template>
  </AdaptiveModal>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { NAlert, NButton, NInput, NRadioButton, NRadioGroup, NSpace, NSpin, NText } from 'naive-ui'
import { Clapperboard, Film, Upload, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { TemplateProcessor } from '@prompt-optimizer/core'
import { useFunctionModelManager } from '../../composables/model/useFunctionModelManager'
import { useToast } from '../../composables/ui/useToast'
import { useVideoCreateSession } from '../../stores/session/useVideoCreateSession'
import { extractVideoPrompt, readReferenceVideo } from '../../services/video-prompt-from-reference'
import { getI18nErrorMessage } from '../../utils/error'
import type { AppServices } from '../../types/services'
import AdaptiveModal from '../common/AdaptiveModal.vue'
import ReferenceActionButton from '../media/ReferenceActionButton.vue'
import ReferenceModelSwitch from '../media/ReferenceModelSwitch.vue'

const LARGE_VIDEO_WARNING_BYTES = 20 * 1024 * 1024
const VIDEO_FILE_EXTENSION_RE = /\.(?:mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|ogv|3gp|flv|ts|wmv)$/i

withDefaults(defineProps<{ disabled: boolean; compact?: boolean }>(), { compact: false })

const services = inject<Ref<AppServices | null>>('services', ref(null))
const openModels = inject<(tab: 'function') => void>('openModelManager', () =>
  window.dispatchEvent(new CustomEvent('model-manager:set-tab', { detail: 'function' })))
const models = useFunctionModelManager(services)
const session = useVideoCreateSession()
const toast = useToast()
const { t } = useI18n()

const show = ref(false)
const busy = ref(false)
const sourceKind = ref<'file' | 'url'>('file')
const picker = ref<HTMLInputElement | null>(null)
const urlInput = ref<InstanceType<typeof NInput> | null>(null)
const file = shallowRef<File | null>(null)
const previewUrl = ref('')
const durationSeconds = ref<number | null>(null)
const url = ref('')
const error = ref('')
const pendingResult = ref('')
const dragDepth = ref(0)
let revision = 0

const source = computed(() => sourceKind.value === 'url' ? url.value.trim() : file.value)
const externalDragOver = computed(() => dragDepth.value > 0 && !busy.value)
const isLargeFile = computed(() => sourceKind.value === 'file' && !!file.value && file.value.size > LARGE_VIDEO_WARNING_BYTES)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const mins = Math.floor(rounded / 60)
  const secs = String(rounded % 60).padStart(2, '0')
  return `${mins}:${secs}`
}

const fileStats = computed(() => {
  if (!file.value) return ''
  const parts = [formatFileSize(file.value.size)]
  if (durationSeconds.value !== null) parts.push(formatDuration(durationSeconds.value))
  return parts.join(' · ')
})

function isVideoFile(candidate: File): boolean {
  if (candidate.type && candidate.type !== 'application/octet-stream') {
    return candidate.type.startsWith('video/')
  }
  return VIDEO_FILE_EXTENSION_RE.test(candidate.name)
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  durationSeconds.value = null
}

function setSelectedFile(candidate: File | null) {
  if (!candidate) return
  if (!isVideoFile(candidate)) {
    error.value = t('video.reverse.invalidFile')
    return
  }
  revokePreview()
  file.value = candidate
  error.value = ''
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    previewUrl.value = URL.createObjectURL(candidate)
  }
}

function clearFile() {
  revokePreview()
  file.value = null
  error.value = ''
}

function triggerPicker() {
  if (busy.value) return
  picker.value?.click()
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  input.value = ''
  if (picked) setSelectedFile(picked)
}

function onLoadedMetadata(event: Event) {
  const media = event.target as HTMLVideoElement
  if (Number.isFinite(media.duration) && media.duration > 0) {
    durationSeconds.value = media.duration
  }
}

function hasDraggedFiles(event: DragEvent): boolean {
  const transfer = event.dataTransfer
  if (!transfer) return false
  if (transfer.files && transfer.files.length > 0) return true
  return Array.from(transfer.types || []).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  dragDepth.value += 1
}

function onDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = busy.value ? 'none' : 'copy'
  }
}

function onDragLeave(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  dragDepth.value = 0
  if (busy.value) return
  const dropped = event.dataTransfer?.files?.[0] ?? null
  if (dropped) setSelectedFile(dropped)
}

function onPaste(event: ClipboardEvent) {
  if (!show.value || busy.value || pendingResult.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-testid="model-manager-dialog"]')) return
  const pastedFiles = Array.from(event.clipboardData?.files ?? [])
  if (pastedFiles.length > 0) {
    event.preventDefault()
    sourceKind.value = 'file'
    setSelectedFile(pastedFiles[0])
    return
  }
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
  if (text && isValidHttpUrl(text)) {
    event.preventDefault()
    sourceKind.value = 'url'
    url.value = text
    error.value = ''
  }
}

function onUrlEnter() {
  if (source.value && !busy.value) void generate()
}

function close() {
  revision++
  show.value = false
  busy.value = false
  dragDepth.value = 0
  revokePreview()
  file.value = null
  url.value = ''
  error.value = ''
  pendingResult.value = ''
}

watch(show, visible => {
  if (typeof window === 'undefined') return
  if (visible) {
    window.addEventListener('paste', onPaste)
  } else {
    window.removeEventListener('paste', onPaste)
  }
})

watch(sourceKind, async kind => {
  error.value = ''
  dragDepth.value = 0
  if (show.value && kind === 'url') {
    await nextTick()
    urlInput.value?.focus()
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('paste', onPaste)
  }
  close()
})
watch(() => session.state, close, { flush: 'sync' })
watch(source, () => { error.value = '' })

async function apply(prompt: string) {
  session.state.originalPrompt = prompt
  close()
  try {
    if (!await session.saveSession()) throw new Error(t('video.error.save'))
    toast.success(t('video.reverse.applied'))
  } catch (cause) { toast.error(getI18nErrorMessage(cause)) }
}

async function generate() {
  const selected = source.value
  const app = services.value
  if (!selected || busy.value || !app) return
  if (typeof selected === 'string' && !isValidHttpUrl(selected)) {
    error.value = t('video.reverse.invalidUrl')
    return
  }
  if (typeof selected !== 'string' && !isVideoFile(selected)) {
    error.value = t('video.reverse.invalidFile')
    return
  }
  const at = revision
  const brief = session.state.originalPrompt
  busy.value = true
  error.value = ''
  try {
    await models.initialize()
    if (at !== revision) return
    const key = models.effectiveVideoUnderstandingModel.value
    if (!key) {
      toast.info(t('functionModel.noVideoUnderstandingModel'))
      openModels('function')
      return
    }
    const [template, video] = await Promise.all([
      app.templateManager.getTemplate('video-prompt-from-reference'),
      typeof selected === 'string' ? { kind: 'url' as const, url: selected } : readReferenceVideo(selected),
    ])
    if (at !== revision) return
    const [instruction] = TemplateProcessor.processTemplate(template, {})
    const response = await app.llmService.sendVideoUnderstanding({ prompt: instruction.content, video }, key)
    if (at !== revision) return
    const result = extractVideoPrompt(response.content)
    if (!result) throw new Error(t('video.reverse.invalidResult'))
    if (brief === session.state.originalPrompt) await apply(result)
    else pendingResult.value = result
  } catch (cause) {
    if (at === revision) error.value = getI18nErrorMessage(cause)
  } finally {
    if (at === revision) busy.value = false
  }
}
</script>

<style scoped>
.video-reverse-hint {
  font-size: 13px;
  line-height: 1.5;
}

.video-reverse-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.video-drop-surface {
  position: relative;
  border-radius: 14px;
}

.video-drop-empty {
  width: 100%;
  min-height: 148px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 16px;
  border: 1px dashed var(--n-border-color);
  border-radius: 14px;
  background: var(--n-color-embedded);
  color: var(--n-text-color-2);
  cursor: pointer;
  appearance: none;
  font: inherit;
  text-align: center;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
}

.video-drop-empty:hover:not(:disabled) {
  border-color: var(--n-border-color-hover);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.video-drop-empty:focus-visible {
  outline: none;
  border-color: var(--n-primary-color);
  box-shadow: 0 0 0 2px var(--n-primary-color-suppl);
}

.video-drop-empty:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.video-drop-empty__icon {
  color: var(--n-text-color-3);
}

.video-drop-empty__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color-1);
}

.video-drop-empty__hint {
  font-size: 12px;
  line-height: 1.45;
  color: var(--n-text-color-3);
}

.video-file-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--n-border-color);
  border-radius: 14px;
  background: var(--n-color);
}

.video-file-card__player-wrap {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}

.video-file-card__player {
  display: block;
  width: 100%;
  max-height: 210px;
  object-fit: contain;
}

.video-file-card__player--compact {
  max-height: 160px;
}

.video-file-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.video-file-card__info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.video-file-card__icon {
  flex: none;
  color: var(--n-text-color-3);
}

.video-filename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.video-file-card__stats {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.video-file-card__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.video-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--n-primary-color);
  border-radius: inherit;
  background: color-mix(in srgb, var(--n-color) 92%, var(--n-primary-color));
  color: var(--n-primary-color);
  font-size: 14px;
  font-weight: 500;
  pointer-events: none;
}

.video-reverse-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
</style>
