import { FRESH_PARTICIPANT, FRESH_PARTICIPANTS, expect, login, test, testImage } from './helpers.js'

/**
 * 参赛者打卡的完整链路（design.md §7.3、§7.4）。
 *
 * 这是产品的核心路径，也是 §3 第 1 条「正常流程控制在一分钟以内」的验证对象。
 */
test.describe('参赛者打卡', () => {
  test('从登录到提交，并在主页看到「已提交，等待审核」', async ({ page }) => {
    const startedAt = Date.now()

    await login(page, FRESH_PARTICIPANT)

    // §7.3：三张赛道卡片
    await expect(page.getByText('读书')).toBeVisible()
    await expect(page.getByText('单词背诵')).toBeVisible()
    await expect(page.getByText('运动健身')).toBeVisible()

    // 找一个今天还没打卡的赛道
    const submitButton = page.getByRole('button', { name: '去打卡' }).first()
    await expect(submitButton, '这个账号今天应当还有未打卡的赛道').toBeVisible()
    await submitButton.click()

    await page.waitForURL('**/checkin/**')

    // §7.4：证明要求必须显著展示 —— 看不清要求是驳回的最主要来源
    await expect(page.getByText('有效证明要求')).toBeVisible()
    // 上传规则来自活动配置，不是写死的
    await expect(page.getByText(/1–3 张.*单张不超过/)).toBeVisible()

    // 未选图时提交按钮不可用，并说明原因
    const submit = page.getByRole('button', { name: /提\s*交/ })
    await expect(submit).toBeDisabled()
    await expect(page.getByText(/至少需要 1 张证明材料/)).toBeVisible()

    // 选一张真实的 PNG，走完整个上传流水线（含服务端的解码与 EXIF 剥离）
    await page.setInputFiles('input[type="file"]', testImage())
    await expect(page.locator('.image-thumb')).toHaveCount(1)
    await expect(submit).toBeEnabled()

    await submit.click()

    // 提交成功后回到主页，对应卡片变成待审核
    await page.waitForURL('**/home', { timeout: 30_000 })
    await expect(page.getByText('已提交，等待审核').first()).toBeVisible()

    // §7.3「待审核」在截止前可重新提交
    await expect(page.getByRole('button', { name: '重新提交' }).first()).toBeVisible()

    // §3 的目标：一分钟以内。用宽裕一点的预算，慢了说明有性能问题。
    const elapsed = Date.now() - startedAt
    expect(elapsed, `打卡耗时 ${elapsed}ms，超过 60 秒的目标`).toBeLessThan(60_000)
  })

  test('伪装成图片的文件在本地就被拦下（§7.4）', async ({ page }) => {
    await login(page, FRESH_PARTICIPANT)

    const submitButton = page.getByRole('button', { name: '去打卡' }).first()
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await page.waitForURL('**/checkin/**')

    // 内容是一段文本，只是扩展名叫 .jpg
    await page.setInputFiles('input[type="file"]', {
      name: 'fake.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('这不是图片，只是把扩展名改成了 .jpg', 'utf8'),
    })

    // 客户端按文件内容识别格式，在上传之前就拒绝 ——
    // 否则用户要等几十秒上传完才收到服务端的同样的结论
    await expect(page.getByText(/不是有效的图片/)).toBeVisible()
    await expect(page.locator('.image-thumb')).toHaveCount(0)
  })

  test('超过 600KB 的照片在浏览器里压过之后再上传（§7.4）', async ({ page }) => {
    /*
      用 FRESH_PARTICIPANTS[2]：这个用例会产生待审核记录，
      与前两条用例共号会让它们的「重新提交」点到别的赛道上。
    */
    await login(page, FRESH_PARTICIPANTS[2])

    const submitButton = page.getByRole('button', { name: '去打卡' }).first()
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await page.waitForURL('**/checkin/**')

    /*
      原图必须真的超标，否则这条用例什么都没验到：
      服务端会在 640KB 处拒绝，所以「提交成功」本身就证明了字节是在
      浏览器里压下来的 —— 没有压缩功能时它会直接 400。
      实测 makePng 的渐变图：1600×1200 是 692KB，2000×1500 是 877KB。
    */
    const large = testImage(2000, 1500, 3)
    expect(large.buffer.length, '这条用例需要一张明显超过 600KB 的原图').toBeGreaterThan(600 * 1024)

    await page.setInputFiles('input[type="file"]', large)
    await expect(page.locator('.image-thumb')).toHaveCount(1)

    // 压出来的必须仍是一张能解码的图片，而不是 canvas 吐出的坏字节
    const thumb = page.locator('.image-thumb img').first()
    await expect(thumb).toBeVisible()
    expect(await thumb.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)

    /*
      真正要守的那条产品要求：**上传的字节**在 600KB 以内。

      只断言「提交成功」是不够的 —— 那只能说明它过了服务端 640KB 的线，
      压到 630KB 也会通过。缩略图指向的就是即将上传的那个压缩产物
      （见 ImagePicker：收下的是 prepareImage 的产物），直接量它。

      不用 Playwright 的 postDataBuffer：multipart 的请求体它取不到，返回 null。
    */
    const uploadedBytes = await page
      .locator('.image-thumb img')
      .first()
      .evaluate(async (element) => {
        const response = await fetch((element as HTMLImageElement).src)
        return (await response.blob()).size
      })
    expect(uploadedBytes, `压缩后是 ${uploadedBytes} 字节，应当不超过 600KB`).toBeLessThanOrEqual(
      600 * 1024,
    )

    await page.getByRole('button', { name: /提\s*交/ }).click()
    await page.waitForURL('**/home', { timeout: 30_000 })
    await expect(page.getByText('已提交，等待审核').first()).toBeVisible()
  })

  test('重新提交产生新版本，而槽位仍然只有一个', async ({ page }) => {
    // 用另一个未打卡账号：这个用例会产生待审核记录，
    // 与前一个用例共号会让它的「重新提交」点到别的赛道上
    await login(page, FRESH_PARTICIPANTS[1])

    // 第一次提交
    const submitButton = page.getByRole('button', { name: '去打卡' }).first()
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await page.waitForURL('**/checkin/**')

    const firstSubmit = page.waitForResponse(
      (r) => r.url().endsWith('/checkins') && r.request().method() === 'POST',
    )
    await page.setInputFiles('input[type="file"]', testImage(320, 240, 1))
    await page.getByRole('button', { name: /提\s*交/ }).click()
    const entryId = ((await (await firstSubmit).json()) as { entry_id: string }).entry_id
    await page.waitForURL('**/home', { timeout: 30_000 })

    // 待审核的卡片此时提供「重新提交」（§7.3）
    await page.getByRole('button', { name: '重新提交' }).first().click()
    await page.waitForURL('**/checkin/**')

    await page.setInputFiles('input[type="file"]', testImage(320, 240, 2))
    await page.getByRole('button', { name: /提\s*交/ }).click()
    await page.waitForURL('**/home', { timeout: 30_000 })

    /**
     * §6.3 的不变量是「同一槽位只有一条记录，重新提交只增加版本」。
     *
     * 关键是**回到同一个 entry**。早先的写法是在记录列表里按状态找第一条，
     * 但前一个用例也会给这个账号留下待审核记录，很可能打开的是另一条 ——
     * 于是断言「第 2 版」时看到的是别人的第 1 版。
     * 直接从提交响应里拿到 entry_id 最准。
     */
    await page.goto(`/records/${entryId}`)

    await expect(page.getByText('提交信息')).toBeVisible()
    await expect(page.getByText('第 2 版')).toBeVisible()
    await expect(page.getByText(/提交历史（1 个较早版本）/)).toBeVisible()
  })
})
