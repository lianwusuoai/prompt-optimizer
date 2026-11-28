import { expect, test, type Page } from '@playwright/test'
import { fillOriginalPrompt } from '../helpers/analysis'

test.use({ locale: 'en-US' })

async function readPrompt(page: Page) {
  const input = page.getByTestId('image-text2image-input').filter({ visible: true })
  const editor = input.locator('.cm-content')
  return await editor.count() ? editor.innerText() : input.locator('textarea').inputValue()
}

test('previews a reference, keeps it across model changes, and applies only confirmed image actions', async ({ page }) => {
  test.setTimeout(90_000)
  const endpoint = 'https://image-recognition.invalid/v1'
  const firstModel = 'vision-default'
  const secondModel = 'vision-alternate'
  const subject = 'A lighthouse above a stormy sea'
  const calls: { model: string; messages: unknown }[] = []
  const externalPosts: string[] = []
  let releaseRequest!: () => void
  const pendingRequest = new Promise<void>(resolve => { releaseRequest = resolve })
  await page.addInitScript(() => { Object.assign(window, { __TEST_DB_NAME__: 'image-reference-test' }) })
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    if (host === 'localhost' || host === '127.0.0.1') return route.continue()
    if (route.request().method() === 'POST') externalPosts.push(host)
    return route.abort()
  })
  await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript',
    body: 'window.runtime_config=' + JSON.stringify({ CUSTOM_API_KEY: 'fixture', CUSTOM_API_BASE_URL: endpoint, CUSTOM_API_MODEL: firstModel }) }))
  await page.route(endpoint + '/models', route => route.fulfill({
    json: { data: [firstModel, secondModel].map(id => ({ id, object: 'model' })) },
  }))
  await page.route(endpoint + '/chat/completions', async route => {
    calls.push(route.request().postDataJSON())
    const index = calls.length
    if (index === 2) await pendingRequest
    if (index === 3) return route.fulfill({ status: 400, json: { error: { message: 'Image input rejected' } } })
    const prompt = { subject: index === 1 ? 'A {{color}} sailboat' : index === 2 ? 'Discarded result' : 'A lighthouse in pastel chalk' }
    const content = JSON.stringify({ prompt, defaults: { color: 'amber' } })
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content } }] } })
  })
  await page.goto('/#/image/text2image')
  const replicate = page.getByTestId('reference-action-replicate-button').filter({ visible: true })
  const learn = page.getByTestId('reference-action-style-learn-button').filter({ visible: true })
  const dialog = page.getByTestId('image-reference-dialog')
  const picker = page.getByTestId('image-reference-picker')
  const submit = page.getByTestId('image-reference-submit')
  const preview = page.getByTestId('image-reference-preview').locator('img')
  const selector = page.getByTestId('function-imageRecognitionModel')
  const selectModel = async (name: string) => {
    await selector.click()
    await page.locator('.text-model-menu:visible [data-config-id="custom"] [data-model-choice]').filter({ hasText: name }).click()
    await expect(selector).toContainText(name)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('model-manager-dialog')).toBeHidden()
  }

  await expect(replicate).toBeVisible({ timeout: 30_000 })
  await expect(learn).toBeDisabled()
  await expect(replicate).toHaveCSS('border-top-left-radius', '999px')
  await expect(replicate).toHaveCSS('font-weight', '500')
  await replicate.click()
  await expect(selector).toBeVisible()
  await expect(dialog).toBeVisible()
  await page.getByRole('dialog').filter({ has: selector }).getByRole('button', { name: 'close', exact: true }).click()
  await expect(page.getByTestId('model-manager-dialog')).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('image-reference-change-model')).toHaveAccessibleName('Configure Model')
  await expect(submit).toBeDisabled()

  const transfer = await page.evaluateHandle(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(image => resolve(image!), 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'reference.png', { type: 'image/png' }))
    return data
  })
  await picker.locator('.reference-image-picker__surface').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(preview).toBeVisible()
  const imageSrc = await preview.getAttribute('src')
  expect(imageSrc).toMatch(/^data:image\/png;base64,/)
  await submit.click()
  await selectModel(firstModel)
  await expect(page.getByTestId('image-reference-model')).toContainText(firstModel)
  await expect(preview).toHaveAttribute('src', imageSrc!)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.getByTestId('image-reference-change-model').click()
  await selectModel(secondModel)
  await expect(page.getByTestId('image-reference-model')).toContainText(secondModel)
  await expect(preview).toHaveAttribute('src', imageSrc!)
  expect(calls).toHaveLength(0)
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => readPrompt(page)).toContain('sailboat')
  await expect(page.locator('.temporary-variable-value textarea').first()).toHaveValue('amber')
  expect(calls[0].model).toBe(secondModel)
  expect(JSON.stringify(calls[0].messages)).toContain(imageSrc!)

  await fillOriginalPrompt(page, 'image-text2image', subject)
  await page.setViewportSize({ width: 390, height: 844 })
  const toolsMenu = page.getByRole('button', { name: 'Prompt tools' }).filter({ visible: true })
  await toolsMenu.click()
  await learn.click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeInViewport({ ratio: 0.95 })
  await page.evaluate(data => {
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }))
  }, transfer)
  await expect(preview).toHaveAttribute('src', imageSrc!)
  expect(calls).toHaveLength(1)
  await submit.click()
  await expect.poll(() => calls.length).toBe(2)
  await page.getByTestId('image-reference-cancel').click()
  const completed = page.waitForResponse(endpoint + '/chat/completions')
  releaseRequest()
  await completed
  await expect.poll(() => readPrompt(page)).toBe(subject)

  if (!await learn.isVisible()) await toolsMenu.click()
  await learn.click()
  await expect(submit).toBeDisabled()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByTestId('image-reference-choose').click()
  await (await fileChooser).setFiles({ name: 'picked.png', mimeType: 'image/png', buffer: Buffer.from(imageSrc!.split(',')[1], 'base64') })
  await expect(preview).toBeVisible()
  await submit.click()
  await expect(dialog.getByRole('alert')).toContainText('Image input rejected')
  await expect(preview).toHaveAttribute('src', imageSrc!)
  await expect.poll(() => readPrompt(page)).toBe(subject)
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => readPrompt(page)).toContain('lighthouse in pastel chalk')
  expect(calls).toHaveLength(4)
  expect(JSON.stringify(calls[3].messages)).toContain(subject)
  expect(calls[3].model).toBe(secondModel)
  expect(externalPosts).toEqual([])
})
