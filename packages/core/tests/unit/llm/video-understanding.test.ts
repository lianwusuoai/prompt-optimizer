import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextAdapterRegistry } from '../../../src/services/llm/adapters/registry'
import { LLMService } from '../../../src/services/llm/service'
import type { TextModelConfig, VideoUnderstandingSource } from '../../../src/services/llm/types'

const link = { kind: 'url', url: 'https://media.invalid/clip?sig=abc' } as const
const file = { kind: 'inline', mimeType: 'video/webm', data: 'GkXfow==' } as const
const prompt = 'Recreate the reference video.'

function setup(provider: string, requestStyle = 'chat_completions') {
  const registry = new TextAdapterRegistry()
  const adapter = registry.getAdapter(provider)
  const model: TextModelConfig = {
    id: 'connection', name: 'My connection', enabled: true,
    providerMeta: adapter.getProvider(), modelMeta: adapter.buildDefaultModel('wire-model'),
    connectionConfig: { apiKey: 'test-only', baseURL: 'https://endpoint.invalid', requestStyle },
    paramOverrides: {},
  }
  const service = new LLMService({ getModel: async () => model }, registry)
  return (video: VideoUnderstandingSource) => service.sendVideoUnderstanding({ prompt, video }, model.id)
}

function capture(response: object, status = 200) {
  const post = vi.fn(async (_url: unknown, init: RequestInit) =>
    new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', post)
  return () => {
    expect(post).toHaveBeenCalledTimes(1)
    return JSON.parse(post.mock.calls[0][1].body as string)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('video input on the configured text model protocol', () => {
  it.each([link, file])('sends $kind video natively via DashScope chat', async video => {
    const body = capture({ choices: [{ message: { content: 'prompt' } }] })
    expect((await setup('dashscope')(video)).content).toBe('prompt')
    expect(body().messages).toEqual([{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'video_url', video_url: { url: video.kind === 'url' ? link.url : 'data:video/webm;base64,' + file.data } },
    ] }])
  })

  it.each([link, file])('sends $kind video as a Responses video part', async video => {
    const body = capture({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'prompt' }] }] })
    expect((await setup('openai-compatible', 'responses')(video)).content).toBe('prompt')
    expect(body().input).toEqual([{ role: 'user', content: [
      { type: 'input_text', text: prompt },
      { type: 'input_video', video_url: video.kind === 'url' ? link.url : 'data:video/webm;base64,' + file.data },
    ] }])
  })

  it.each([link, file])('sends $kind video as a native Gemini part', async video => {
    const body = capture({ candidates: [{ content: { role: 'model', parts: [{ text: 'prompt' }] } }] })
    expect((await setup('gemini')(video)).content).toBe('prompt')
    expect(body().contents[0].parts).toEqual([
      video.kind === 'url' ? { fileData: { fileUri: link.url } } : { inlineData: { mimeType: file.mimeType, data: file.data } },
      { text: prompt },
    ])
  })

  it('forwards a provider rejection of an attached video file', async () => {
    const body = capture({ type: 'error', error: { type: 'invalid_request_error', message: 'Unsupported file media type' } }, 400)
    await expect(setup('anthropic')(file)).rejects.toThrow('Unsupported file media type')
    expect(body().messages[0].content[0]).toEqual({
      type: 'document', source: { type: 'base64', media_type: file.mimeType, data: file.data },
    })
  })

  it('returns the provider error after a single request', async () => {
    const body = capture({ error: { message: 'Video inference unavailable on this deployment' } }, 503)
    await expect(setup('openai-compatible')(link)).rejects.toThrow('Video inference unavailable on this deployment')
    expect(body().model).toBe('wire-model')
  })
})
