import type { VideoUnderstandingSource } from '@prompt-optimizer/core'
import { parseModelJsonObject } from '../utils/model-response-json'

export function extractVideoPrompt(content: string): string {
  const body = withoutPromptHeading(content ?? '')
  // Some video models return the finished prose even when asked for a JSON object.
  const hasJson = /(?:^|[\n：:])\s*(?:\{|\[\s*[{\]"]|```(?:json)?(?:\s|$))/i.test(body)
  if (!hasJson) return body
  try {
    const { prompt } = parseModelJsonObject(body)
    return typeof prompt === 'string' ? withoutPromptHeading(prompt) : ''
  } catch {
    return ''
  }
}

function withoutPromptHeading(content: string): string {
  const text = content.trim()
  const heading = /^([^\r\n:：]+)[:：][ \t]*(?:\r?\n|$)/u.exec(text)
  if (!heading) return text
  const label = heading[1].trim()
  const isChineseIntro = /^(?:(?:[这這]是|以下是|下面是).*)?提示[词詞]$/u.test(label)
  const isEnglishIntro = /^(?:(?:here(?:['’]s| is)|below is)\b.*\bprompt\b.*|(?:video )?prompt)$/iu.test(label)
  return isChineseIntro || isEnglishIntro ? text.slice(heading[0].length).trimStart() : text
}

export function readReferenceVideo(file: File): Promise<VideoUnderstandingSource> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const dataUrl = String(reader.result)
      resolve({ kind: 'inline', mimeType: file.type || 'application/octet-stream', data: dataUrl.slice(dataUrl.indexOf(',') + 1) })
    }
    reader.readAsDataURL(file)
  })
}
