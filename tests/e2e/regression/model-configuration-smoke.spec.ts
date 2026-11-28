import { test, expect } from '../fixtures'

test.describe('Model configuration smoke', () => {
  test('first-use model selector opens connections with switchable text, image, video, and function tabs', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="workspace"][data-mode="basic-system"]')).toBeVisible({
      timeout: 45000,
    })

    const modelSelect = page.getByTestId('basic-system-model-select')
    await expect(modelSelect).toBeVisible()
    await modelSelect.click()

    const menu = page.locator('.text-model-menu:visible')
    await expect(menu.getByRole('status')).toBeVisible()
    await expect(menu.locator('[data-model-choice]')).toHaveCount(0)
    await menu.getByRole('button', { name: /^(添加连接|Add Connection)$/i }).click()

    const dialog = page.getByTestId('model-manager-dialog')
    await expect(dialog).toBeVisible()

    const connectionName = page.getByTestId('text-model-name')
    await expect(connectionName).toBeVisible()
    await page.getByRole('button', { name: /^(取消|Cancel)$/i }).click()
    await expect(connectionName).toBeHidden()

    const tabs = page.getByTestId('model-manager-tabs')
    const tabItems = tabs.locator('.n-tabs-tab')
    for (const tabLabel of [/^(图像|Image)$/, /^(视频|Video)$/, /^(功能默认|Function Defaults)$/, /^(文本|Text)$/]) {
      const tab = tabItems.filter({ hasText: tabLabel })
      await tab.click()
      await expect(tab).toHaveClass(/n-tabs-tab--active/)
    }
  })
})
