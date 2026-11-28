// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextAdapterRegistry } from '../../../src/services/llm/adapters/registry'
import { subscriptionConnectionId, type SubscriptionModel } from '../../../src/services/llm/adapters/chatgpt-subscription-adapter'
import { ModelManager } from '../../../src/services/model/manager'
import { LLMService } from '../../../src/services/llm/service'
import { MemoryStorageProvider } from '../../../src/services/storage/memoryStorageProvider'
import { encodeTextModelSelection } from '../../../src/services/model/selection'
import { EvaluationService } from '../../../src/services/evaluation/service'
import { TemplateManager } from '../../../src/services/template/manager'
import { TemplateLanguageService } from '../../../src/services/template/languageService'
import { PreferenceService } from '../../../src/services/preference/service'

const provider = 'chatgpt-subscription'
const ref = 'test-connection'
const model: SubscriptionModel = { slug: 'allowed-a', name: 'Text A', efforts: ['low', 'high'], tools: true }
const second: SubscriptionModel = { slug: 'allowed-b', name: 'Text B', efforts: ['medium'], tools: false }
const id = subscriptionConnectionId(ref)
const messages = [{ role: 'system' as const, content: 'instructions' }, { role: 'user' as const, content: 'question' }]
function setup() {
  const abort = new AbortController()
  const access = vi.fn(async (connection: string, slug: string, signal?: AbortSignal) => {
    const selected = [model, second].find(item => item.slug === slug)
    if (connection !== ref || !selected) throw new Error('chatgptSubscription.modelUnavailable')
    return { token: 'synthetic-access', signal: signal ?? abort.signal, model: selected }
  })
  const registry = new TextAdapterRegistry({ access })
  const manager = new ModelManager(new MemoryStorageProvider(), registry)
  return { registry, manager, llm: new LLMService(manager, registry), access }
}
function stream(events: unknown[]) {
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } })
}
const success = [
  { type: 'response.output_text.delta', delta: 'answer' },
  { type: 'response.completed', response: { output: [], usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } },
]
afterEach(() => vi.unstubAllGlobals())

describe('managed ChatGPT text models', () => {
  it('publishes one callable connection per authorized account with its current text catalog', async () => {
    const { manager, llm } = setup()
    const before = await manager.getAllModels()
    await manager.syncSubscriptionModels(ref, [model, second])
    const rows = await manager.getAllModels()
    expect(rows.filter(config => config.providerId !== provider)).toEqual(before)
    expect(rows.filter(config => config.providerId === provider)).toHaveLength(1)
    expect(await manager.getModel(id)).toMatchObject({ enabled: true, modelId: model.slug, name: 'ChatGPT',
      connectionConfig: { subscriptionRef: ref }, availableModels: [{ id: model.slug }, { id: second.slug }] })
    const choices = [model, second].map(item => ({ value: item.slug, label: item.name }))
    expect(await llm.fetchModelList(provider, { id })).toEqual(choices)
    expect(await llm.fetchModelList(id)).toEqual(choices)
    await manager.syncSubscriptionModels(ref, [second])
    expect((await manager.getModel(id))?.modelId).toBe(second.slug)
    await expect(manager.getModel(encodeTextModelSelection(id, model.slug))).rejects.toThrow('modelUnavailable')
    await manager.syncSubscriptionModels(ref, [])
    expect(await manager.getModel(id)).toBeUndefined()
    await manager.syncSubscriptionModels(ref, [model])
    await manager.syncSubscriptionModels(null, [])
    expect(await manager.getModel(id)).toBeUndefined()
  })

  it('sends the model and reasoning choice from each test column, including a saved run snapshot', async () => {
    const { manager, llm } = setup()
    await manager.syncSubscriptionModels(ref, [model, second])
    const a = encodeTextModelSelection(id, model.slug, { reasoning_effort: 'high' })
    const b = encodeTextModelSelection(id, second.slug, { reasoning_effort: 'medium' })
    const snapshot = (await manager.getModel(b))!
    expect(snapshot.modelMeta.capabilities.supportsTools).toBe(false)
    expect(snapshot.modelMeta.parameterDefinitions[0].allowedValues).toEqual(['medium'])
    const post = vi.fn(async (_url: unknown, _request: RequestInit) => stream(success))
    vi.stubGlobal('fetch', post)
    await llm.sendMessage(messages, a)
    await llm.sendMessageStream(messages, id, { onToken() {}, onComplete() {}, onError() {} }, { configSnapshot: snapshot })
    expect(post.mock.calls.map(([, options]) => {
      const body = JSON.parse(String(options.body))
      return [body.model, body.reasoning.effort]
    })).toEqual([[model.slug, 'high'], [second.slug, 'medium']])
  })

  it('tests the unsaved selection and preserves edited connection settings through catalog refresh', async () => {
    const { manager, llm } = setup()
    await manager.syncSubscriptionModels(ref, [model, second])
    await manager.updateModel(id, { name: 'Work plan', paramOverrides: { reasoning_effort: 'high' }, enabled: false })
    const post = vi.fn(async (_url: unknown, _request: RequestInit) => stream(success))
    vi.stubGlobal('fetch', post)
    await llm.testConnection(id)
    await llm.testConnection(id, { modelId: model.slug, paramOverrides: {} })
    await llm.testConnection(id, { modelId: second.slug, paramOverrides: { reasoning_effort: 'medium' } })
    expect(post.mock.calls.map(([, request]) => {
      const { model, reasoning } = JSON.parse(String(request.body))
      return [model, reasoning?.effort]
    })).toEqual([[model.slug, 'high'], [model.slug, undefined], [second.slug, 'medium']])
    expect(await manager.getModel(id)).toMatchObject({ modelId: model.slug, paramOverrides: { reasoning_effort: 'high' } })
    await expect(manager.updateModel(id, { modelId: 'outside-catalog' })).rejects.toThrow('modelUnavailable')
    await manager.updateModel(id, { modelId: second.slug, paramOverrides: { reasoning_effort: 'medium' } })
    await manager.syncSubscriptionModels(ref, [model, second])
    expect(await manager.getModel(id)).toMatchObject({ name: 'Work plan', enabled: false, modelId: second.slug,
      modelMeta: { name: second.name, capabilities: { supportsTools: false } }, paramOverrides: { reasoning_effort: 'medium' } })
    await manager.syncSubscriptionModels(ref, [model])
    const fallback = await manager.getModel(id)
    expect(fallback).toMatchObject({ name: 'Work plan', enabled: false, modelId: model.slug })
    expect(fallback?.paramOverrides).toEqual({})
  })

  it('uses the fixed subscription endpoint and strict request fields for streaming and one-shot service calls', async () => {
    const { manager, llm } = setup()
    await manager.syncSubscriptionModels(ref, [model])
    await manager.updateModel(id, { connectionConfig: { subscriptionRef: ref, baseURL: 'https://example.invalid' } })
    const post = vi.fn(async () => stream(success))
    vi.stubGlobal('fetch', post)
    const key = encodeTextModelSelection(id, model.slug, { reasoning_effort: 'high', temperature: 0.8, max_output_tokens: 3 })
    const result = await llm.sendMessageStructured(messages, key)
    expect(result.content).toBe('answer')
    expect(result.metadata?.model).toBe(model.slug)
    const [url, options] = post.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-access')
    expect(JSON.parse(String(options.body))).toEqual({ model: model.slug, store: false, stream: true,
      reasoning: { effort: 'high' }, input: [{ role: 'developer', content: 'instructions' }, messages[1]] })
    const onToken = vi.fn(), onComplete = vi.fn()
    await llm.sendMessageStream(messages, id, { onToken, onComplete, onError: vi.fn() })
    expect(onToken).toHaveBeenCalledWith('answer')
    expect(onComplete).toHaveBeenCalledOnce()
    await manager.disableModel(id)
    await expect(llm.sendMessage(messages, id)).rejects.toThrow(/not enabled/)
    await llm.testConnection(id)
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('runs a workspace evaluation using the registered model and built-in evaluation template', async () => {
    const { llm, manager } = setup()
    await manager.syncSubscriptionModels(ref, [model])
    const storage = new MemoryStorageProvider()
    const language = new TemplateLanguageService(new PreferenceService(storage))
    await language.initialize()
    const service = new EvaluationService(llm, manager, new TemplateManager(storage, language))
    const content = JSON.stringify({ score: { overall: 85, dimensions: [{ key: 'clarity', label: 'Clarity', score: 85 }] },
      improvements: [], patchPlan: [], summary: 'Clear instructions.' })
    vi.stubGlobal('fetch', vi.fn(async () => stream([{ type: 'response.output_text.delta', delta: content }, success[1]])))
    const result = await service.evaluate({ type: 'prompt-only', target: { workspacePrompt: 'Write a project summary.' },
      evaluationModelKey: id, mode: { functionMode: 'basic', subMode: 'system' } })
    expect(result).toMatchObject({ score: { overall: 85 }, metadata: { model: id }, summary: 'Clear instructions.' })
  })

  it.each([
    [[{ type: 'response.output_text.delta', delta: 'partial' }], 'incomplete'],
    [[{ type: 'response.incomplete', response: {} }], 'incomplete'],
    [[{ type: 'response.output_text.delta', delta: 'partial' }, { type: 'response.failed', response: {
      error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private upstream diagnostic' } } }], 'usageLimit'],
  ] as const)('does not succeed or replay after an interrupted or failed stream', async (events, code) => {
    const { llm, manager } = setup()
    await manager.syncSubscriptionModels(ref, [model])
    const post = vi.fn(async () => stream([...events]))
    vi.stubGlobal('fetch', post)
    const onComplete = vi.fn(), onError = vi.fn()
    await expect(llm.sendMessageStream(messages, id, { onToken() {}, onComplete, onError })).rejects.toThrow('chatgptSubscription.' + code)
    expect(post).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })
});
