import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.use({ locale: 'en-US' })

test('replicates a URL or file in the selected template language and keeps only the prompt', async ({ page }) => {
  const dbName = 'video-replication-' + Date.now()
  await page.addInitScript(name => { Object.assign(window, { __TEST_DB_NAME__: name }) }, dbName)
  const endpoint = 'https://video-understanding.invalid/v1'
  const wireModel = 'alternate-video-model'
  const videoUrl = 'https://media.invalid/signed?clip=sample&sig=abc'
  const clip = 'tests/e2e/fixtures/video-preview-short.mp4'
  const englishBrief = 'A woman in a pink cardigan smiles at the camera.'
  const chineseBrief = '固定近景。一位穿粉色开衫的短发女子看向镜头，随后笑起来。'
  const reportedIntro = '这是一段根据视频内容生成的提示词：'
  const wireInputs: string[] = []
  const unexpected: string[] = []
  await page.route('**/*', route => {
    const { hostname } = new URL(route.request().url())
    if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue()
    if (route.request().method() === 'POST' || hostname === 'media.invalid') unexpected.push(route.request().url())
    return route.abort()
  })
  await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript',
    body: 'window.runtime_config=' + JSON.stringify({ CUSTOM_API_KEY: 'fixture', CUSTOM_API_BASE_URL: endpoint, CUSTOM_API_MODEL: 'connection-default' }) }))
  await page.route(endpoint + '/models', route => route.fulfill({
    json: { object: 'list', data: [wireModel, 'connection-default'].map(id => ({ id, object: 'model' })) },
  }))
  await page.route(endpoint + '/chat/completions', async route => {
    const body = route.request().postDataJSON()
    expect(body.model).toBe(wireModel)
    const [user] = body.messages
    expect(user.role).toBe('user')
    expect(user.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(wireInputs.length === 0 ? 'in English' : '中文提示词') })
    expect(user.content[0].text).toMatch(/continuous shot|连续镜头/i)
    expect(user.content[0].text).toContain('{"prompt":')
    expect(user.content[1].type).toBe('video_url')
    wireInputs.push(user.content[1].video_url.url)
    if (wireInputs.length === 2) return route.fulfill({ status: 415, json: { error: { message: 'This deployment rejects the supplied video codec' } } })
    let content = reportedIntro + '\n\n' + chineseBrief
    if (wireInputs.length === 1) content = 'Here is the prompt based on the video:\n\n' + JSON.stringify({ prompt: englishBrief })
    if (wireInputs.length === 3) content = JSON.stringify({ prompt: [] })
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content } }] } })
  })

  await page.goto('/#/video/create')
  const open = page.getByTestId('video-reverse-open')
  const submit = page.getByTestId('video-reverse-generate')
  const brief = page.getByTestId('video-input').locator('textarea')
  const inputCard = page.locator('.video-original')
  await expect(open).toBeVisible({ timeout: 30_000 })
  await expect(open).toHaveCSS('border-top-left-radius', '999px')
  await expect(open).toHaveCSS('font-weight', '500')
  await inputCard.getByRole('button', { name: 'Collapse', exact: true }).click()
  await expect(open).toBeVisible()
  await inputCard.getByRole('button', { name: 'Expand', exact: true }).click()
  const desktopViewport = page.viewportSize()!
  await page.setViewportSize({ width: 390, height: 844 })
  await open.click()
  const selector = page.getByTestId('function-videoUnderstandingModel')
  await expect(selector).toBeVisible()
  await expect(submit).toBeVisible()
  expect(wireInputs).toHaveLength(0)
  await selector.click()
  await page.locator('.text-model-menu:visible [data-config-id="custom"] [data-model-choice]').filter({ hasText: wireModel }).click()
  await expect(selector).toContainText(wireModel)
  await page.evaluate(() => history.back())
  await expect(page.getByTestId('model-manager-dialog')).toBeHidden()
  await expect(page.getByTestId('video-reverse-model')).toContainText(wireModel)
  await expect(submit).toBeVisible()
  await expect(page).toHaveURL(/#\/video\/create$/)
  expect(wireInputs).toHaveLength(0)
  await page.setViewportSize(desktopViewport)
  await page.getByTestId('video-reverse-url-mode').click()
  await page.getByTestId('video-reverse-url').locator('input').fill(videoUrl)
  await submit.click()
  await expect(brief).toHaveValue(englishBrief)

  await page.getByTestId('header-modal-actions').getByRole('button', { name: /Templates/ }).click()
  const language = page.getByTitle('Switch built-in template language')
  await expect(language).toHaveText('English')
  await language.click()
  await expect(language).toHaveText('中文')
  await page.keyboard.press('Escape')
  await expect(language).toBeHidden()
  await page.reload()

  await open.click()
  await page.getByTestId('video-reverse-file-mode').click()
  const filePicker = page.getByTestId('video-reverse-file')
  expect(await filePicker.getAttribute('accept')).toBe('video/*')
  await filePicker.setInputFiles(clip)
  await submit.click()
  await expect(page.getByTestId('video-reverse-error')).toContainText('This deployment rejects the supplied video codec')
  await expect(brief).toHaveValue(englishBrief)
  await submit.click()
  await expect(page.getByTestId('video-reverse-error')).toContainText('Could not read the prompt')
  await expect(brief).toHaveValue(englishBrief)
  await submit.click()
  await expect(brief).toHaveValue(chineseBrief)
  const dataUrl = 'data:video/mp4;base64,' + (await readFile(clip)).toString('base64')
  expect(wireInputs).toEqual([videoUrl, dataUrl, dataUrl, dataUrl])
  expect(unexpected).toEqual([])

  await page.reload()
  await expect(brief).toHaveValue(chineseBrief)
  const stored = await page.evaluate(name => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open(name)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const get = db.transaction('storage').objectStore('storage').get('pref:session/v1/video-create')
      get.onsuccess = () => { db.close(); resolve(JSON.stringify(get.result)) }
      get.onerror = () => reject(get.error)
    }
  }), dbName)
  expect(stored).toContain(chineseBrief)
  expect(stored).not.toContain(reportedIntro)
  expect(stored).not.toContain(videoUrl)
  expect(stored).not.toContain(dataUrl.split(',')[1].slice(0, 80))
  await open.click()
  await expect(submit).toBeVisible()
  await expect(submit).toBeDisabled()
})
