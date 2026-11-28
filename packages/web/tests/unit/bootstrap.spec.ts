import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const startApp = vi.fn()

beforeEach(() => {
  vi.resetModules()
  startApp.mockClear()
  vi.doMock('../../src/main', () => {
    startApp({ ...Reflect.get(window, 'runtime_config') })
    return {}
  })
})

afterEach(() => {
  vi.doUnmock('../../src/main')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('loads desktop configuration as data before evaluating the application', async () => {
  const reply = Promise.withResolvers<Record<string, string>>()
  const getEnvironmentVariables = vi.fn(() => reply.promise)
  vi.stubGlobal('electronAPI', { config: { getEnvironmentVariables } })
  vi.stubGlobal('runtime_config', { EXISTING: 'web' })
  const started = import('../../src/bootstrap')
  await vi.waitFor(() => expect(getEnvironmentVariables).toHaveBeenCalledOnce())
  expect(startApp).not.toHaveBeenCalled()

  const value = 'line 1\n"line 2"'
  reply.resolve({ EXAMPLE: value, VITE_EXAMPLE: value, EXISTING: '' })
  await started
  expect(startApp).toHaveBeenCalledExactlyOnceWith({ EXAMPLE: value, VITE_EXAMPLE: value, EXISTING: 'web' })
})

it('starts with the configuration supplied by config.js in a browser', async () => {
  vi.stubGlobal('runtime_config', { EXISTING: 'web' })
  await import('../../src/bootstrap')
  expect(startApp).toHaveBeenCalledExactlyOnceWith({ EXISTING: 'web' })
})

it('still opens the workspace if the desktop bridge cannot read the environment', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('runtime_config', {})
  vi.stubGlobal('electronAPI', { config: { getEnvironmentVariables: vi.fn().mockRejectedValue(new Error('offline')) } })
  await import('../../src/bootstrap')
  expect(startApp).toHaveBeenCalledExactlyOnceWith({})
})
