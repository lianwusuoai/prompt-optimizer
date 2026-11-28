export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseModelJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim()
  // Backticks may be part of the scene text inside a JSON string.
  const candidate = trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed
    : trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() || trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  const jsonText = start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (cause) {
    throw new Error('Model response is not valid JSON', { cause })
  }
  if (!isRecord(parsed)) throw new Error('Model response is not a valid JSON object')
  return parsed
}
