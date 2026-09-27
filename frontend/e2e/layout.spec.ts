import type { Page, ViewportSize } from '@playwright/test'
import { SUBMITTED_PARTICIPANT, expect, login, test } from './helpers.js'

/**
 * 参赛者端的桌面布局适配（design.md §10.1）。
 *
 * 这个文件跑在 desktop 项目里，但**自己切视口**：断点是纯宽度的媒体查询
 * （min-width: 992px），与 isMobile / DPR / 触摸能力都无关，所以一个桌面
 * context 把视口设成 412×915，得到的就是手机布局。
 *
 * 这样做的理由是不把参赛者端其余用例跑两遍 —— 那样会真的坏掉：
 * helpers.ts 里每个提交类用例独占一个未打卡账号（只有 3 个），第二次运行
 * 会消费掉同一个账号；checkin.spec.ts 还断言「第 2 版」，重跑就成了第 3 版，
 * 而失败信息完全指不到原因。
 *
 * 参赛者端此前只在 412px 下跑过，桌面形态没有任何覆盖。
 */

const MOBILE: ViewportSize = { width: 412, height: 915 }
/** 断点两侧各取一个值，把 992 这个数字钉在测试里 */
const JUST_BELOW: ViewportSize = { width: 991, height: 900 }
const JUST_ABOVE: ViewportSize = { width: 992, height: 900 }
const DESKTOP: ViewportSize = { width: 1280, height: 800 }

/**
 * 手机的**真实视口**高度，与上面的 MOBILE（915）不是一回事。
 *
 * 915 是 Pixel 7 的物理屏高，`devices['Pixel 7']` 实际的 viewport 是
 * 412×839（`playwright-core` 的 device descriptor），mobile-chrome 项目跑的
 * 就是 839。用 915 量「一屏放不放得下」等于白送 76px。
 */
const PHONE_VIEWPORT: ViewportSize = { width: 412, height: 839 }

/**
 * 两个盒子是否在同一排。
 *
 * 不能断言 `y` 相等：同一排里字高不同的两个元素按中心对齐，`y` 会差几个像素
 * （姓名 15px、班级那行 12px，实测差 2.3px）。判据是垂直范围有重叠。
 */
function sameRow(a: { y: number; height: number }, b: { y: number; height: number }): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height
}

/** 登录（会落到 /home），再切到指定视口并进入目标页 */
async function openAt(page: Page, viewport: ViewportSize, path: string): Promise<void> {
  await login(page, SUBMITTED_PARTICIPANT)
  await page.setViewportSize(viewport)
  await page.goto(path)
}

test.describe('参赛者端布局', () => {
  test('断点两侧：991 是手机形态，992 换成桌面形态', async ({ page }) => {
    await openAt(page, JUST_BELOW, '/home')

    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.locator('.top-nav')).toBeHidden()

    // 只改宽度、不重新加载：媒体查询立即重新求值
    await page.setViewportSize(JUST_ABOVE)

    await expect(page.locator('.top-nav')).toBeVisible()
    await expect(page.locator('.bottom-nav')).toBeHidden()
  })

  test('412px 下仍是手机形态：内容铺满，且为底部导航留出了高度', async ({ page }) => {
    await openAt(page, MOBILE, '/home')

    await expect(page.locator('.top-nav')).toBeHidden()

    const shell = page.locator('.participant-shell')
    expect((await shell.boundingBox())!.width, '手机上内容应当铺满，而不是被收窄').toBe(412)

    // 桌面块把 padding-bottom 归零了，但那条规则必须只作用于 ≥992 ——
    // 手机上少了这块留白，最后一张卡会被底部导航压住
    const paddingBottom = await shell.evaluate((el) => getComputedStyle(el).paddingBottom)
    expect(paddingBottom, '底部导航的留白只能由手机规则提供').toBe('56px')
  })

  /**
   * 「一屏放得下」这条产品要求（§7.3：一分钟内完成打卡，关键信息一屏看完）
   * 今天**没有任何 CSS 强制**：.participant-shell 是 min-height: 100vh，
   * 页面之所以不滚，全靠内容比视口短。这条断言守的就是这份预算。
   *
   * 底部的赞助商展示位（§7.7）按剩余空间自适应（88–160px），常态下会把余量
   * 吃到只剩几像素 —— 这条断言主要验的就是**广告位算得对**：它没有多占。
   * 会顶出滚动条的是这几种，产品已明确接受，不在这里覆盖：
   *   1. 广告位缩到 88px 下限而上方内容还在长 —— 活动未开放时首页顶部多一条
   *      提示横幅（实测溢出约 85px）、当天三条驳回（约 65px）；
   *   2. 手机上展开「修改密码」（表单比广告位让出来的空间更高）；
   *   3. 赞助目录为空时广告位不渲染，这条断言退化成只守着页面本身。
   */
  test('412×839：常态下首页与「我的」页都放得下一屏', async ({ page }) => {
    await openAt(page, PHONE_VIEWPORT, '/home')

    const heightOf = () =>
      page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

    expect(await heightOf(), '首页常态下不该出现纵向滚动').toBeLessThanOrEqual(0)

    await page.goto('/me')
    expect(await heightOf(), '「我的」页不该出现纵向滚动').toBeLessThanOrEqual(0)
  })

  test('1280px 下：顶栏铺满视口，内容居中在一列，标题不被顶栏压住', async ({ page }) => {
    await openAt(page, DESKTOP, '/home')

    const shell = await page.locator('.participant-shell').boundingBox()
    // 壳放宽到 1040 并居中 —— 不再是那条 560 的竖条
    expect(shell!.width).toBe(1040)
    expect(shell!.x).toBe((1280 - 1040) / 2)

    const nav = await page.locator('.top-nav').boundingBox()
    // 顶栏是 fixed，逃出壳的宽度限制、铺满整个视口；
    // 只让它跟内容一样宽的话，两侧会漏出底色，内容滚过时像坏掉了
    expect(nav!.width, '顶栏应当铺满视口').toBe(1280)
    expect(nav!.y).toBe(0)

    // 顶栏不占流，靠壳上的 padding-top 补偿。少了它首页标题会被压在栏下面
    const firstCard = await page.locator('.track-grid .ant-card').first().boundingBox()
    expect(firstCard!.y, '内容要落在顶栏下方').toBeGreaterThanOrEqual(56)
  })

  test('1280px 下首页三张赛道卡并排，而不是继续纵向堆叠', async ({ page }) => {
    await openAt(page, DESKTOP, '/home')

    const cards = page.locator('.track-grid .ant-card')
    await expect(cards).toHaveCount(3)

    const [first, second, third] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
      cards.nth(2).boundingBox(),
    ])

    expect(first!.y).toBe(second!.y)
    expect(second!.y).toBe(third!.y)
    expect(second!.x).toBeGreaterThan(first!.x)
    expect(third!.x).toBeGreaterThan(second!.x)
  })

  test('排行榜行：手机上姓名与班级分两行，桌面上并为一排', async ({ page }) => {
    await openAt(page, MOBILE, '/leaderboard')
    await page.waitForSelector('.lb-row')

    const nameMobile = await page.locator('.lb-row__name').first().boundingBox()
    const metaMobile = await page.locator('.lb-row__meta').first().boundingBox()
    expect(sameRow(nameMobile!, metaMobile!), '手机上「班级 · 有效天数」在姓名下一行').toBe(false)

    await page.setViewportSize(DESKTOP)

    const nameDesktop = await page.locator('.lb-row__name').first().boundingBox()
    const metaDesktop = await page.locator('.lb-row__meta').first().boundingBox()
    // 桌面用网格把它们排到同一排 —— 宽出来的空间被这行小字填掉，
    // 而不是留成「姓名 —————— 分数」之间的一片空白
    expect(sameRow(nameDesktop!, metaDesktop!), '桌面上两者应当同一排').toBe(true)

    const scoreDesktop = await page.locator('.lb-row__score').first().boundingBox()
    expect(scoreDesktop!.x).toBeGreaterThan(metaDesktop!.x)
  })

  test('证明材料网格在桌面上不会跟着容器放大成巨型方块', async ({ page }) => {
    await openAt(page, MOBILE, '/records')

    // 用第一条记录即可：哪怕只有一张图也测得出列宽 —— 单张图的宽度就等于一格
    await page.locator('.ant-card').first().click()
    const thumbs = page.locator('.image-thumb')
    await expect(thumbs.first()).toBeVisible()

    const mobileWidth = (await thumbs.first().boundingBox())!.width
    // 手机上仍是 3 等分（412 − 32 页边距 − 24 卡内边距 ≈ 356，一格约 113px）。
    // 若列数被改成 2，这里会变成约 178 —— 断言的上界会拦住
    expect(mobileWidth).toBeGreaterThan(90)
    expect(mobileWidth).toBeLessThan(150)

    await page.setViewportSize(DESKTOP)

    const desktopWidth = (await thumbs.first().boundingBox())!.width
    /*
      桌面用 auto-fill + minmax(150px, 1fr)，在 672px 的阅读列里落成 4 列、
      每格约 156px。若沿用手机的 repeat(3, 1fr)，同样的容器下每格会是约 210px ——
      格子跟着容器等比放大，正是要避免的那种「手机版拉宽」。
      所以这条断言的意义在**上界**：它必须明显小于 3 等分的宽度。
    */
    expect(desktopWidth, '格子不该跟着容器放大').toBeLessThan(190)
    expect(desktopWidth).toBeGreaterThan(120)
  })
})
