import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import VideoReverseAction from '../../../src/components/video-mode/VideoReverseAction.vue'
import { useVideoCreateSession } from '../../../src/stores/session/useVideoCreateSession'

const { toastMock, effectiveModel, initModelsMock, refreshModelsMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  effectiveModel: { value: 'dashscope::qwen-vl-max' },
  initModelsMock: vi.fn(async () => {}),
  refreshModelsMock: vi.fn(async () => {}),
}))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: { model: string }) => params?.model || key,
    }),
  }
})

vi.mock('../../../src/composables/ui/useToast', () => ({
  useToast: () => toastMock,
}))

vi.mock('../../../src/composables/model/useFunctionModelManager', () => ({
  useFunctionModelManager: () => ({
    initialize: initModelsMock,
    refresh: refreshModelsMock,
    effectiveVideoUnderstandingModel: effectiveModel,
  }),
}))

const createDragEvent = (
  type: string,
  { files = [], types = [] }: { files?: File[]; types?: string[] } = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      types,
      dropEffect: 'none',
      effectAllowed: 'copy',
    },
  })
  return event
}

describe('VideoReverseAction', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-video-preview')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    effectiveModel.value = 'dashscope::qwen-vl-max'
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mountComponent(overrides: {
    sendVideoUnderstanding?: ReturnType<typeof vi.fn>
    openModels?: ReturnType<typeof vi.fn>
  } = {}) {
    const sendVideoUnderstanding = overrides.sendVideoUnderstanding ?? vi.fn(async () => ({
      content: JSON.stringify({ prompt: 'A steady close-up of a sailboat.' }),
    }))
    const openModels = overrides.openModels ?? vi.fn()
    const services = ref({
      modelManager: {
        getModel: vi.fn(async () => ({
          id: 'dashscope',
          name: '阿里云百炼',
          modelId: 'qwen-vl-max',
          modelMeta: { id: 'qwen-vl-max' },
        })),
      },
      templateManager: {
        getTemplate: vi.fn(async () => ({
          id: 'video-prompt-from-reference',
          name: 'video-prompt-from-reference',
          content: [{ role: 'user', content: 'Describe this video.' }],
          metadata: { version: '1.0.0', lastModified: 1, templateType: 'videoPromptComposition' },
        })),
      },
      llmService: { sendVideoUnderstanding },
    })

    const session = useVideoCreateSession()
    vi.spyOn(session, 'saveSession').mockResolvedValue(true)

    const wrapper = mount(VideoReverseAction, {
      props: { disabled: false },
      global: {
        provide: {
          services,
          openModelManager: openModels,
        },
        stubs: {
          AdaptiveModal: {
            props: ['show'],
            emits: ['update:show'],
            template: '<div v-if="show" data-testid="modal-stub"><slot /><slot name="action" /></div>',
          },
        },
      },
    })

    return { wrapper, session, sendVideoUnderstanding, openModels }
  }

  it('ignores a missing-model check from a dismissed picker and prompts once on the next opening', async () => {
    effectiveModel.value = ''
    let finishCheck!: () => void
    initModelsMock.mockImplementationOnce(() => new Promise<void>(resolve => { finishCheck = resolve }))
    const { wrapper, openModels } = mountComponent()
    const trigger = wrapper.get('[data-testid="video-reverse-open"]')
    await trigger.trigger('click')
    await wrapper.get('[data-testid="video-reverse-cancel"]').trigger('click')
    finishCheck()
    await flushPromises()
    expect(openModels).not.toHaveBeenCalled()

    await trigger.trigger('click')
    await flushPromises()
    expect(openModels).toHaveBeenCalledWith('function')
    window.dispatchEvent(new Event('video-workspace-refresh-models'))
    await flushPromises()
    expect(openModels).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="video-reverse-choose"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('filters to video/*, accepts drag-and-drop video upload, shows preview/remove, and rejects non-video drops', async () => {
    const { wrapper } = mountComponent()

    await wrapper.get('[data-testid="video-reverse-open"]').trigger('click')
    await flushPromises()

    const fileInput = wrapper.get('[data-testid="video-reverse-file"]')
    expect(fileInput.attributes('accept')).toBe('video/*')
    expect(wrapper.get('[data-testid="video-reverse-model"]').text()).toContain('阿里云百炼 · qwen-vl-max')

    const dropzone = wrapper.get('[data-testid="video-reverse-dropzone"]')
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    dropzone.element.dispatchEvent(createDragEvent('drop', { files: [textFile], types: ['Files'] }))
    await flushPromises()
    expect(wrapper.get('[data-testid="video-reverse-error"]').text()).toBe('video.reverse.invalidFile')
    expect(wrapper.find('[data-testid="video-reverse-preview-card"]').exists()).toBe(false)

    const unknownText = new File(['hello'], 'notes.txt', { type: 'application/octet-stream' })
    dropzone.element.dispatchEvent(createDragEvent('drop', { files: [unknownText], types: ['Files'] }))
    await flushPromises()
    expect(wrapper.get('[data-testid="video-reverse-error"]').text()).toBe('video.reverse.invalidFile')
    expect(wrapper.find('[data-testid="video-reverse-preview-card"]').exists()).toBe(false)

    const genericMp4 = new File([new Uint8Array(1024)], 'generic.mp4', { type: 'application/octet-stream' })
    dropzone.element.dispatchEvent(createDragEvent('drop', { files: [genericMp4], types: ['Files'] }))
    await flushPromises()
    expect(wrapper.get('[data-testid="video-reverse-preview-card"]').text()).toContain('generic.mp4')

    const clip = new File([new Uint8Array(2048)], 'sample.mp4', { type: 'video/mp4' })
    dropzone.element.dispatchEvent(createDragEvent('dragenter', { files: [clip], types: ['Files'] }))
    await flushPromises()
    expect(wrapper.find('.video-drop-overlay').exists()).toBe(true)

    dropzone.element.dispatchEvent(createDragEvent('drop', { files: [clip], types: ['Files'] }))
    await flushPromises()
    expect(wrapper.find('.video-drop-overlay').exists()).toBe(false)
    expect(wrapper.get('[data-testid="video-reverse-preview-card"]').text()).toContain('sample.mp4')
    expect(createObjectURL).toHaveBeenCalledWith(clip)

    await wrapper.get('[data-testid="video-reverse-remove"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="video-reverse-preview-card"]').exists()).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-video-preview')

    wrapper.unmount()
  })

  it('warns on large video files without blocking, validates URLs, and allows cancelling while analyzing', async () => {
    let resolveCall!: (value: { content: string }) => void
    const pendingCall = new Promise<{ content: string }>(resolve => { resolveCall = resolve })
    const sendVideoUnderstanding = vi.fn(() => pendingCall)
    const openModels = vi.fn()
    const { wrapper, session } = mountComponent({ sendVideoUnderstanding, openModels })
    session.state.originalPrompt = 'Existing brief'

    await wrapper.get('[data-testid="video-reverse-open"]').trigger('click')
    await flushPromises()

    const bigFile = new File(['x'], 'large.mov', { type: 'video/quicktime' })
    Object.defineProperty(bigFile, 'size', { value: 25 * 1024 * 1024 })
    wrapper.get('[data-testid="video-reverse-dropzone"]').element.dispatchEvent(
      createDragEvent('drop', { files: [bigFile], types: ['Files'] }),
    )
    await flushPromises()
    expect(wrapper.get('[data-testid="video-reverse-size-warning"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="video-reverse-generate"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="video-reverse-url-mode"] input').setValue(true)
    await flushPromises()
    await wrapper.get('[data-testid="video-reverse-url"] input').setValue('not-a-url')
    await wrapper.get('[data-testid="video-reverse-generate"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="video-reverse-error"]').text()).toBe('video.reverse.invalidUrl')
    expect(sendVideoUnderstanding).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="video-reverse-url"] input').setValue('https://example.invalid/clip.mp4')
    await wrapper.get('[data-testid="video-reverse-url"] input').trigger('keydown.enter')
    await flushPromises()
    expect(sendVideoUnderstanding).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="video-reverse-analyzing"]').exists()).toBe(true)

    await wrapper.get('[data-testid="video-reverse-cancel"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="modal-stub"]').exists()).toBe(false)

    resolveCall({ content: JSON.stringify({ prompt: 'Late result should be ignored' }) })
    await flushPromises()
    expect(session.state.originalPrompt).toBe('Existing brief')

    await wrapper.get('[data-testid="video-reverse-open"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="video-reverse-file-mode"] input').setValue(true)
    await flushPromises()
    const clip = new File([new Uint8Array(1024)], 'keep-me.mp4', { type: 'video/mp4' })
    wrapper.get('[data-testid="video-reverse-dropzone"]').element.dispatchEvent(
      createDragEvent('drop', { files: [clip], types: ['Files'] }),
    )
    await flushPromises()
    await wrapper.get('[data-testid="video-reverse-change-model"]').trigger('click')
    expect(openModels).toHaveBeenCalledWith('function')
    expect(wrapper.find('[data-testid="modal-stub"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="video-reverse-preview-card"]').text()).toContain('keep-me.mp4')

    effectiveModel.value = ''
    await wrapper.get('[data-testid="video-reverse-generate"]').trigger('click')
    await flushPromises()
    expect(openModels).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="modal-stub"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="video-reverse-preview-card"]').text()).toContain('keep-me.mp4')
    expect(wrapper.find('[data-testid="video-reverse-change-model"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
