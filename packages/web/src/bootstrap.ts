const host = window as Window & {
  electronAPI?: { config?: { getEnvironmentVariables(): Promise<Record<string, string>> } }
  runtime_config?: Record<string, string>
}

if (host.electronAPI?.config) {
  try {
    const variables = await host.electronAPI.config.getEnvironmentVariables()
    const config = host.runtime_config ??= {}
    for (const [key, value] of Object.entries(variables)) {
      if (value !== '') config[key] = value
    }
  } catch (error) {
    console.warn('[Desktop] Could not load runtime configuration', error)
  }
}

// UI and provider modules read runtime settings during module evaluation.
await import('./main')
export {}
