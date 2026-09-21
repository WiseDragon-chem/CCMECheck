/**
 * 操作指导（src/features/guide）。
 *
 * **从 '@playwright/test' 直接 import base test**，不走 e2e/helpers.ts 的
 * fixture —— 那个 fixture 会把所有引导预置成「看过了」，这里要验的恰恰是
 * 引导本身会不会弹。其余 spec 则要用那个 fixture，否则引导会挡住点击。
 *
 * 文案在这里写死字面量，与其他 spec 一致：端到端验的就是用户真正看到的字。
 * 引导文案改动时，这个文件要跟着改 —— 也因此它同时是「文案被误删」的哨兵。
 */
import { expect, test, type Page } from '@playwright/test'
import { SUBMITTED_PARTICIPANT, login, seedToursSeen } from './helpers.js'

const KEY = (id: string) => `ccme:tour:v1:${id}`

const seen = (page: Page, id: string) =>
  page.evaluate((k) => window.localStorage.getItem(k), KEY(id))

/** 引导的浮层：rc-tour 把气泡和目标占位都挂在 body 上 */
const tourPanel = (page: Page) => page.locator('.ant-tour')

test.describe('操作指导', () => {
  test('首次进入登录页演示第 1 步，并高亮到「去激活」上', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByText('新用户请先激活')).toBeVisible()
    await expect(page.getByText('第 1 步，共 2 步')).toBeVisible()

    /*
      高亮是不是真的落在「去激活」上 —— 这一条不能省。
      目标找不到时 rc-tour 不会报错，只是静默地把气泡居中、不高亮，
      于是「引导还能弹」和「引导指对了地方」是两回事。
      .ant-tour-target-placeholder 是按目标的矩形摆的，比对两者的位置
      就能确认锚点解析成功（rc-tour 会给它加 6px 的 gap，留点余量）。
    */
    const target = await page.locator('[data-tour="login-activate"]').boundingBox()
    const anchor = await page.locator('.ant-tour-target-placeholder').boundingBox()
    expect(target, '「去激活」应当存在').not.toBeNull()
    expect(anchor, '引导应当已经锚定到某个目标上').not.toBeNull()
    expect(Math.abs(target!.x - anchor!.x)).toBeLessThan(12)
    expect(Math.abs(target!.y - anchor!.y)).toBeLessThan(12)
  })

  test('关闭后记下「看过」，再进登录页不再出现', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('新用户请先激活')).toBeVisible()

    expect(await seen(page, 'login'), '关之前不该有标记').toBeNull()

    await page.getByRole('button', { name: '知道了' }).click()
    await expect(tourPanel(page)).toBeHidden()

    expect(await seen(page, 'login')).toBe('1')

    // 「每个浏览器只演示一遍」—— 这条是整件事的核心断言
    await page.reload()
    await expect(page.getByText('还没有激活？')).toBeVisible()
    await expect(page.getByText('新用户请先激活')).toBeHidden()
  })

  test('第 2 步接在激活页上', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: '知道了' }).click()
    await page.getByRole('link', { name: '去激活' }).click()
    await page.waitForURL('**/activate')

    await expect(page.getByText('填写管理员发的激活码')).toBeVisible()
    await expect(page.getByText('第 2 步，共 2 步')).toBeVisible()

    await page.getByRole('button', { name: '知道了' }).click()
    expect(await seen(page, 'activate')).toBe('1')
  })

  test('引导开着时，被高亮的目标仍然点得动', async ({ page }) => {
    /*
      整个登录页那步都建立在这条上：遮罩只挡住高亮之外的区域
      （rc-tour 的 disabledInteraction 默认为 false，遮罩层带
      pointer-events: none）。若哪天有人顺手把它改成 true，
      用户就得先关掉引导才点得到「去激活」，而界面看上去毫无异常。
    */
    await page.goto('/login')
    await expect(page.getByText('新用户请先激活')).toBeVisible()

    await page.getByRole('link', { name: '去激活' }).click()
    await page.waitForURL('**/activate')
    await expect(page).toHaveURL(/\/activate$/)
  })

  test('主页面演示完整的三步，跨过卡片与状态', async ({ page }) => {
    /*
      只静音登录页与激活页那两段。登录流程本身会路过 /login，
      不静音的话登录页的引导会先弹出来挡路，测不到主页面的那三步。
      'home' 不预置，所以它在登录后会弹出来 —— 这正是要验的。
    */
    await seedToursSeen(page, ['login', 'activate'])
    await login(page, SUBMITTED_PARTICIPANT)

    await expect(page.getByText('每天到点截止，过时不能补交')).toBeVisible()

    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByText('打卡方法')).toBeVisible()

    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByText('状态怎么看，被驳回怎么办')).toBeVisible()

    // 最后一步是「知道了」而不是「完成」：这套引导只讲事，不做操作
    await page.getByRole('button', { name: '知道了' }).click()
    expect(await seen(page, 'home')).toBe('1')
  })

  test('排行榜说明常驻在页面上，不随引导消失', async ({ page }) => {
    await seedToursSeen(page)
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/leaderboard')
    await page.waitForSelector('.lb-row')
    await page.waitForTimeout(800)

    /*
      这句是常驻的，而且必须与真实算分一致：三个赛道各 1 分、等权，
      一天全通过总榜加 3 分。引导只是把它指出来，不是它的载体。
    */
    await expect(page.getByText(/每通过一次打卡得 1 分/)).toBeVisible()
    await expect(page.getByText(/3 条赛道全部通过，总榜加 3 分/)).toBeVisible()
  })

  test('「我的」页能重新播放排行榜说明', async ({ page }) => {
    await seedToursSeen(page)
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/me')
    await page.getByRole('button', { name: '排行榜说明' }).click()
    await page.waitForURL('**/leaderboard')

    // 已标记看过的引导，靠重播入口重新出现
    await expect(page.getByText('每天更新一次，各赛道等权')).toBeVisible()
  })

  test('「我的」页重播打卡说明后，气泡不会在下一秒自己消失', async ({ page }) => {
    await seedToursSeen(page)
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/me')
    await page.getByRole('button', { name: '打卡流程说明' }).click()
    await page.waitForURL('**/home')
    await expect(page.getByText('每天到点截止，过时不能补交')).toBeVisible()

    /*
      主页面每秒重渲染一次（倒计时的 useTicker），引导若只靠「重播请求」
      撑着就会在那一拍里自己关掉 —— 断言不加等待，会在气泡出现的**那一帧**
      就通过，正好放过这个 bug（排行榜那条重播用例就是这么漏过去的：
      那边没有 ticker，压根不重渲染）。所以这里必须等过至少一拍再断言。
    */
    await page.waitForTimeout(1200)
    await expect(page.getByText('每天到点截止，过时不能补交')).toBeVisible()
  })

  test('手机尺寸下气泡不溢出视口', async ({ page }) => {
    // mobile-chrome 项目就是 Pixel 7（412px），这里再确认气泡本身没被挤出去
    await page.goto('/login')
    await expect(page.getByText('新用户请先激活')).toBeVisible()

    const bubble = await page.locator('.ant-tour-content').boundingBox()
    expect(bubble).not.toBeNull()

    const viewport = page.viewportSize()!
    expect(bubble!.x, '气泡左缘不应超出视口').toBeGreaterThanOrEqual(0)
    expect(bubble!.x + bubble!.width, '气泡右缘不应超出视口').toBeLessThanOrEqual(viewport.width)
  })
})
