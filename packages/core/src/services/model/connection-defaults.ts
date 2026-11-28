import { CORE_SERVICE_KEYS } from '../../constants/storage-keys'
import type { IStorageProvider } from '../storage/types'
import { decodeImageModelSelection, decodeTextModelSelection } from './selection'

type Connection = { enabled: boolean; activationState?: { userConfigured?: boolean } }

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const keys = Object.keys(item).sort()
    if (key === 'customParamOverrides' && !keys.length) return undefined
    return Object.fromEntries(keys.map(field => [field, item[field]]))
  })
}

/** A factory entry is disposable only when every saved setting still matches. */
async function unreferencedIds(storage: IStorageProvider, candidates: Set<string>, extraReferences: unknown) {
  if (!candidates.size || !storage.getEntriesByPrefix) return new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const selection = decodeTextModelSelection(value) || decodeImageModelSelection(value)
      candidates.delete(selection?.configId ?? value)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  try {
    const prefixes = ['pref:session/', 'pref:app:function-model:', 'pref:app:image-mode:selected-', 'comparison/v1/records/']
    const [history, runs, ...groups] = await Promise.all([
      storage.getItem(CORE_SERVICE_KEYS.PROMPT_HISTORY), storage.getItem('mcp:runs:v1'),
      ...prefixes.map(prefix => storage.getEntriesByPrefix!(prefix)),
    ] as const)
    for (const raw of [history, runs]) if (raw) visit(JSON.parse(raw))
    for (const entries of groups) {
      for (const [key, raw] of entries) {
        const value = JSON.parse(raw)
        // PreferenceService wraps serialized workspace snapshots in a JSON string.
        visit(key.startsWith('pref:session/') && typeof value === 'string' ? JSON.parse(value) : value)
      }
    }
    visit(extraReferences)
    return candidates
  } catch {
    // A missing or unreadable reference store makes cleanup inconclusive.
    return new Set<string>()
  }
}

/** A null value in a connection map records an explicit deletion of an environment default. */
export async function reconcileConnectionDefaults<T extends Connection>(
  storage: IStorageProvider, key: string, defaults: Record<string, T>,
  factoryDefaults: () => Record<string, T>, extraReferences?: unknown,
): Promise<void> {
  const raw = await storage.getItem(key)
  const saved: Record<string, T | null> = raw ? JSON.parse(raw) : {}
  const candidates = Object.keys(saved).filter(id =>
    saved[id]?.enabled === false && !saved[id]?.activationState?.userConfigured && defaults[id]?.enabled === false)
  const factory = candidates.length ? factoryDefaults() : {}
  const pristine = new Map<string, string>()
  for (const id of candidates) {
    const signature = fingerprint(factory[id])
    if (signature && fingerprint(saved[id]) === signature && fingerprint(defaults[id]) === signature) pristine.set(id, signature)
  }
  const unused = await unreferencedIds(storage, new Set(pristine.keys()), extraReferences)
  const seeds = Object.entries(defaults).filter(([id, config]) => config.enabled && !(id in saved))
  if (raw && !seeds.length && !unused.size) return
  await storage.updateData<Record<string, T | null>>(key, current => {
    const next = { ...current }
    for (const id of unused) {
      if (fingerprint(next[id]) === pristine.get(id)) delete next[id]
    }
    for (const [id, config] of seeds) if (!(id in next)) next[id] = config
    return next
  })
}
