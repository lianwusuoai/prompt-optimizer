import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CORE_SERVICE_KEYS, FUNCTION_MODEL_KEYS, VIDEO_CREATE_SESSION_KEY } from '../../../src/constants/storage-keys'
import { createContextRepo } from '../../../src/services/context/repo'
import { DataManager } from '../../../src/services/data/manager'
import { HistoryManager } from '../../../src/services/history/manager'
import { ImageAdapterRegistry } from '../../../src/services/image/adapters/registry'
import { getDefaultImageModels } from '../../../src/services/image-model/defaults'
import { ImageModelManager } from '../../../src/services/image-model/manager'
import { TextAdapterRegistry } from '../../../src/services/llm/adapters/registry'
import { getDefaultTextModels } from '../../../src/services/model/defaults'
import { ModelManager } from '../../../src/services/model/manager'
import { encodeImageModelSelection, encodeTextModelSelection } from '../../../src/services/model/selection'
import { PreferenceService } from '../../../src/services/preference/service'
import { MemoryStorageProvider } from '../../../src/services/storage/memoryStorageProvider'
import { TemplateManager } from '../../../src/services/template/manager'
import { TemplateLanguageService } from '../../../src/services/template/languageService'
import { VideoModelManager } from '../../../src/services/video-model/manager'

const env = vi.hoisted(() => new Map<string, string>())
vi.mock('../../../src/utils/environment', async original => ({
  ...await original<typeof import('../../../src/utils/environment')>(),
  getEnvVar: (key: string) => env.get(key) || '',
  scanCustomModelEnvVars: () => ({}),
}))
beforeEach(() => env.clear())

const textManager = (storage: MemoryStorageProvider) => new ModelManager(storage, new TextAdapterRegistry())
const imageManager = (storage: MemoryStorageProvider) => new ImageModelManager(storage, new ImageAdapterRegistry())

describe('provider templates and saved connections', () => {
  it('starts empty, requires all provider fields and respects disabling, deleting and adding again', async () => {
    const storage = new MemoryStorageProvider()
    env.set('VITE_CF_API_TOKEN', 'fixture-token')
    expect(await textManager(storage).getAllModels()).toEqual([])
    const images = imageManager(storage)
    await images.ensureInitialized()
    expect(await images.getAllConfigs()).toEqual([])
    expect(await new VideoModelManager(new PreferenceService(storage)).listModels()).toEqual([])
    env.set('VITE_CF_ACCOUNT_ID', 'fixture-account')
    const text = textManager(storage)
    const seeded = (await text.getModel('cloudflare'))!
    expect(seeded.enabled).toBe(true)
    await text.disableModel(seeded.id)
    expect((await textManager(storage).getModel(seeded.id))?.enabled).toBe(false)
    await text.deleteModel(seeded.id)
    const reopened = textManager(storage)
    expect(await reopened.getAllModels()).toEqual([])
    await reopened.addModel(seeded.id, seeded)
    expect((await textManager(storage).getModel(seeded.id))?.enabled).toBe(true)
    const seededImages = imageManager(storage)
    await seededImages.ensureInitialized()
    const [image] = await seededImages.getAllConfigs()
    expect(image.providerId).toBe('cloudflare')
    await seededImages.deleteConfig(image.id)
    const reopenedImages = imageManager(storage)
    await reopenedImages.ensureInitialized()
    expect(await reopenedImages.getAllConfigs()).toEqual([])
    await reopenedImages.addConfig(image)
    expect((await reopenedImages.getConfig(image.id))?.enabled).toBe(true)
  })

  it('removes only factory-unchanged, unused entries across inactive workspaces, tests, history and defaults', async () => {
    const storage = new MemoryStorageProvider()
    const presets = getDefaultTextModels(undefined, () => '')
    const imagePresets = getDefaultImageModels(undefined, () => '')
    const images = ['image-openai-gpt', 'image-gemini-nanobanana']
    await storage.setItem(CORE_SERVICE_KEYS.IMAGE_MODELS, JSON.stringify(Object.fromEntries(images.map(id => [id, imagePresets[id]]))))
    await storage.setItem(CORE_SERVICE_KEYS.MODELS, JSON.stringify({
      deepseek: presets.deepseek, openai: presets.openai, gemini: presets.gemini, grok: presets.grok,
      anthropic: { ...presets.anthropic, connectionConfig: { ...presets.anthropic.connectionConfig, baseURL: 'https://gateway.example' } },
      ollama: { ...presets.ollama, enabled: true }, zhipu: { ...presets.zhipu, activationState: { userConfigured: true } },
    }))
    const prefs = new PreferenceService(storage)
    await prefs.set('session/v1/basic-system', JSON.stringify({ testVariants: [
      { modelKey: encodeTextModelSelection('openai', 'column-model') },
      { modelKey: encodeImageModelSelection(images[0], 'image-model') },
    ] }))
    await prefs.set(FUNCTION_MODEL_KEYS.EVALUATION_MODEL, 'gemini')
    await storage.setItem(CORE_SERVICE_KEYS.PROMPT_HISTORY, JSON.stringify([{ modelKey: 'grok' }]))
    for (let boot = 0; boot < 2; boot++) {
      expect((await textManager(storage).getAllModels()).map(c => c.id).sort()).toEqual(
        ['anthropic', 'gemini', 'grok', 'ollama', 'openai', 'zhipu'])
      const manager = imageManager(storage)
      await manager.ensureInitialized()
      expect((await manager.getAllConfigs()).map(c => c.id)).toEqual([images[0]])
    }
    env.set('VITE_DEEPSEEK_API_KEY', 'fixture-key')
    expect((await textManager(storage).getModel('deepseek'))?.enabled).toBe(true)
  })

  it('imports the selections before cleaning up and gives the same result on repeated imports', async () => {
    const storage = new MemoryStorageProvider()
    const text = textManager(storage)
    const images = imageManager(storage)
    const prefs = new PreferenceService(storage)
    await images.ensureInitialized()
    const data = new DataManager(text, new TemplateManager(storage, new TemplateLanguageService(prefs)),
      new HistoryManager(storage, text), prefs, createContextRepo(storage), images)
    const presets = getDefaultTextModels(undefined, () => '')
    const imagePresets = getDefaultImageModels(undefined, () => '')
    const backup = JSON.stringify({ models: [presets.deepseek, presets.openai],
      imageModels: [imagePresets['image-gemini-nanobanana']],
      userSettings: { [FUNCTION_MODEL_KEYS.EVALUATION_MODEL]: encodeTextModelSelection('openai', 'saved-choice') } })
    for (let attempt = 0; attempt < 2; attempt++) {
      await data.importAllData(backup)
      expect((await text.getAllModels()).map(c => c.id)).toEqual(['openai'])
      expect(await images.getAllConfigs()).toEqual([])
    }
  })

  it('keeps uncertain entries and the default video endpoint while it has a pending task', async () => {
    const storage = new MemoryStorageProvider()
    const { gemini } = getDefaultTextModels(undefined, () => '')
    await storage.setItem(CORE_SERVICE_KEYS.MODELS, JSON.stringify({ gemini }))
    await storage.setItem('pref:session/v1/basic-system', 'invalid')
    expect(await textManager(storage).getModel('gemini')).toBeDefined()
    const prefs = new PreferenceService(storage)
    await prefs.set(VIDEO_CREATE_SESSION_KEY, JSON.stringify({ runs: [{ status: 'queued' }] }))
    const video = new VideoModelManager(prefs)
    expect(await video.getConfig('seedance')).toMatchObject({ providerId: 'ark' })
    await expect(video.removeConfig('seedance')).rejects.toThrow('configInUse')
  })
})
