import OpenAI from 'openai'
import { OpenAIAdapter } from './openai-adapter'
import type { ImageUnderstandingRequest, VideoUnderstandingRequest, LLMResponse, Message, StreamHandlers, TextModel,
  TextModelConfig, TextProvider, ToolDefinition } from '../types'

export const CHATGPT_SUBSCRIPTION_PROVIDER = 'chatgpt-subscription'

export interface SubscriptionModel {
  slug: string
  name: string
  efforts: string[]
  tools: boolean
}

export interface ChatGPTSubscriptionSession {
  access(ref: string, slug: string, signal?: AbortSignal): Promise<{
    token: string
    signal: AbortSignal
    model: SubscriptionModel
  }>
}

export function subscriptionConnectionId(ref: string): string {
  return CHATGPT_SUBSCRIPTION_PROVIDER + ':' + ref
}

export function subscriptionModelMetadata(model: SubscriptionModel): TextModel {
  return {
    id: model.slug, name: model.name, providerId: CHATGPT_SUBSCRIPTION_PROVIDER,
    capabilities: { supportsTools: model.tools, supportsReasoning: model.efforts.length > 0 },
    parameterDefinitions: model.efforts.length ? [{
      name: 'reasoning_effort', type: 'string', labelKey: 'params.reasoning_effort.label', allowedValues: model.efforts,
    }] : [],
  }
}

function subscriptionError(key: string): Error {
  const code = 'chatgptSubscription.' + key
  return Object.assign(new Error(code), { code })
}

function inputMessages(messages: Message[]): unknown[] {
  const items: unknown[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content })
      continue
    }
    if (message.content) items.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content })
    for (const call of message.tool_calls ?? []) {
      items.push({ type: 'function_call', namespace: 'prompt_optimizer', call_id: call.id,
        name: call.function.name, arguments: call.function.arguments })
    }
  }
  return items
}

export class ChatGPTSubscriptionAdapter extends OpenAIAdapter {
  constructor(private readonly session?: ChatGPTSubscriptionSession) { super() }

  getProvider(): TextProvider {
    return { id: CHATGPT_SUBSCRIPTION_PROVIDER, name: 'ChatGPT', defaultBaseURL: 'https://api.openai.com/v1', requiresApiKey: false, supportsDynamicModels: true,
      connectionSchema: { required: [], optional: [], fieldTypes: {} } }
  }

  getModels(): TextModel[] { return [] }
  async getModelsAsync(config: TextModelConfig): Promise<TextModel[]> { return config.availableModels ?? [] }
  protected getParameterDefinitions() { return [] }
  protected getDefaultParameterValues() { return {} }

  buildDefaultModel(slug: string): TextModel {
    return { id: slug, providerId: CHATGPT_SUBSCRIPTION_PROVIDER, name: slug,
      capabilities: { supportsTools: false }, parameterDefinitions: [] }
  }

  protected async doSendMessage(messages: Message[], config: TextModelConfig) {
    return this.collect(inputMessages(messages), config)
  }

  protected async doSendMessageStream(messages: Message[], config: TextModelConfig, callbacks: StreamHandlers) {
    await this.request(inputMessages(messages), config, callbacks)
  }

  async sendMessageStreamWithTools(messages: Message[], config: TextModelConfig, tools: ToolDefinition[], callbacks: StreamHandlers) {
    this.validateMessages(messages)
    await this.request(inputMessages(messages), config, callbacks, tools)
  }

  private imageInput(request: ImageUnderstandingRequest) {
    return this.buildResponsesImageUnderstandingInput(request).map(item =>
      item.role === 'system' ? { ...item, role: 'developer' } : item)
  }

  protected async doSendImageUnderstanding(request: ImageUnderstandingRequest, config: TextModelConfig) {
    return this.collect(this.imageInput(request), config)
  }

  async sendVideoUnderstanding(request: VideoUnderstandingRequest, config: TextModelConfig) {
    return this.collect(this.buildResponsesVideoInput(request), config)
  }

  protected async doSendImageUnderstandingStream(request: ImageUnderstandingRequest, config: TextModelConfig, callbacks: StreamHandlers) {
    await this.request(this.imageInput(request), config, callbacks)
  }

  private async collect(input: unknown[], config: TextModelConfig): Promise<LLMResponse> {
    let result: LLMResponse | undefined
    await this.request(input, config, {
      onToken() {}, onError() {}, onComplete(response) { result = response },
    })
    if (!result) throw subscriptionError('incomplete')
    return result
  }

  private async request(input: unknown[], config: TextModelConfig, callbacks: StreamHandlers, tools: ToolDefinition[] = []) {
    const ref = config.connectionConfig.subscriptionRef
    const slug = config.modelMeta.id
    if (!this.session || typeof ref !== 'string' || config.id !== subscriptionConnectionId(ref)) {
      throw subscriptionError('reconnect')
    }
    const { token, model, signal } = await this.session.access(ref, slug, callbacks.signal).catch(error => {
      if (callbacks.signal?.aborted || error?.name === 'AbortError') throw subscriptionError('cancelled')
      if (typeof error?.code === 'string' && /^chatgptSubscription\.[A-Za-z]+$/.test(error.code)) throw error
      throw subscriptionError('requestFailed')
    })
    if (tools.length && !model.tools) throw subscriptionError('unsupported')
    const effort = config.paramOverrides?.reasoning_effort
    const client = new OpenAI({ apiKey: token, baseURL: 'https://api.openai.com/v1', maxRetries: 0,
      organization: null, project: null, logLevel: 'off',
      fetchOptions: { redirect: 'error' } })
    try {
      const request = { model: slug, input, stream: true, store: false,
        ...(typeof effort === 'string' && model.efforts.includes(effort) ? { reasoning: { effort } } : {}),
        ...(tools.length ? { tools: [{ type: 'namespace', name: 'prompt_optimizer', description: 'User-defined tools',
          tools: tools.map(tool => ({ type: 'function', ...tool.function })) }] } : {}),
      } as OpenAI.Responses.ResponseCreateParamsStreaming
      const stream = await client.responses.create(request, { signal })
      await this.consumeResponsesStream(stream, slug, callbacks, true)
    } catch (error) {
      if (signal.aborted) throw subscriptionError('cancelled')
      const failure = error as { code?: string; status?: number; message?: string }
      if (failure.code === 'subscription_sharing_usage_limit_exceeded') throw subscriptionError('usageLimit')
      if (failure.code === 'subscription_sharing_usage_unavailable') throw subscriptionError('usageUnavailable')
      if (failure.code === 'subscription_sharing_unsupported_capability') throw subscriptionError('unsupported')
      if (failure.code === 'subscription_sharing_user_not_eligible') throw subscriptionError('ineligible')
      if (failure.code === 'subscription_sharing_user_unavailable') throw subscriptionError('usageUnavailable')
      if (failure.status === 401) throw subscriptionError('reconnect')
      if (failure.message === 'chatgptSubscription.incomplete') throw subscriptionError('incomplete')
      throw subscriptionError('requestFailed')
    }
  }
}
