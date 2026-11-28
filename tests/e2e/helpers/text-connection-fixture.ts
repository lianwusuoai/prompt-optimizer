import type { Page } from '@playwright/test'

export async function addTextConnectionFixture(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const workspace = document.querySelector('[data-testid="workspace"], [data-testid="arena-workspace"]') as any
    const app = (document.querySelector('#app') as any).__vue_app__
    // The production extension omits Vue's DOM component pointer.
    const component = workspace.__vueParentComponent ?? app._container._vnode.component.subTree.component
    const { modelManager } = component.provides.services.value
    const id = 'e2e-text-connection'
    await modelManager.addModel(id, {
      id,
      name: 'Test connection',
      enabled: true,
      providerId: 'openai',
      modelId: 'fixture-model',
      connectionConfig: { baseURL: 'https://model-fixture.invalid/v1', apiKey: 'fixture-no-network' },
    })
    return id
  })
}
