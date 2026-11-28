import { test, expect } from '../fixtures'

async function waitForWorkspace(page: any, mode: string) {
  const workspace = page
    .locator(`[data-testid="workspace"][data-mode="${mode}"]`)
    .first()
  await expect(workspace).toBeVisible({ timeout: 45000 })
}

test.describe('Root route bootstrap', () => {
  test('restores the text workspace when storage takes over ten seconds and the favorite image store is pending', async ({ page }) => {
    await page.clock.install()
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open
      const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!
      let delayed = false
      IDBFactory.prototype.open = function (name, version) {
        if (name === 'PromptOptimizerFavoriteImageDB') {
          document.documentElement.dataset.favoriteImageStore = 'waiting'
          return new EventTarget() as IDBOpenDBRequest
        }
        const request = version === undefined ? open.call(this, name) : open.call(this, name, version)
        const testDb = (window as Window & { __TEST_DB_NAME__?: string }).__TEST_DB_NAME__
        if (!delayed && name === testDb) {
          delayed = true
          Object.defineProperty(request, 'onsuccess', {
            set(handler) {
              success.set!.call(request, (event: Event) => {
                window.addEventListener('release-startup-database', () => handler.call(request, event), { once: true })
                document.documentElement.dataset.startupDatabase = 'waiting'
              })
            },
          })
        }
        return request
      }
    })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-startup-database', 'waiting')
    await page.clock.fastForward(11_000)
    await page.evaluate(() => window.dispatchEvent(new Event('release-startup-database')))
    await waitForWorkspace(page, 'basic-system')
    await expect(page.locator('html')).toHaveAttribute('data-favorite-image-store', 'waiting')
  })

  test('navigating to / redirects to default workspace', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // In a clean test DB, global-settings defaults to basic/system.
    await waitForWorkspace(page, 'basic-system')
  })

  test('explicit navigation is not overridden by bootstrap redirect', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Immediately navigate to a non-root route; bootstrap logic must not replace it back.
    await page.goto('/#/image/text2image')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/#\/image\/text2image/)
    await waitForWorkspace(page, 'image-text2image')
  })
})
