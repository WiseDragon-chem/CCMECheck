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

/**
 * 赞助位（§7.7）的两条新规则：**画面铺满内容区宽度、高度按原图比例，没有上限。**
 *
 * 全部相对 DOM 里量出来的宽度与原图的 `naturalWidth/naturalHeight` 算，不写死
 * 像素值：赞助图不入库（`frontend/.gitignore` 挡着），换台机器、换一批图，
 * 比例与张数都不一样，写死的断言在 CI 上必然失败。
 *
 * **先等 `content` 出现再判断有没有赞助位。** goto 只拿到 HTML，首页要等活动
 * 数据回来才渲染（在那之前是一屏 `Skeleton`），那一刻查 `.sponsor` 会得到
 * 「没有赞助位」—— 明明有图也被判成没图，接着去断言「页面不滚」，得到一条
 * 完全指不到原因的失败（实测就踩到了）。两个页面的最终渲染里赞助位与
 * `content` 是同一次画出来的，所以等它等于等到了赞助位。
 *
 * 没有赞助图时（CI 与任何没放图的机器）整块不渲染，那时回到真正的不变量：
 * 页面不滚 —— 参赛者端「一屏放得下」靠的是内容比视口短，不是广告位替它让位。
 */
async function expectSponsorSizing(page: Page, where: string, content: string): Promise<void> {
  await page.waitForSelector(content)

  if ((await page.locator('.sponsor').count()) === 0) {
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(overflow, `${where}：没有赞助图时不该出现纵向滚动`).toBeLessThanOrEqual(0)
    return
  }

  // 量之前先等图加载完：naturalWidth 还是 0 的话，比例断言算出来的是 0
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('.sponsor__img')).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  )

  const frame = page.locator('.sponsor__frame')
  // 内容宽，不含那圈 1px 边框 —— 图铺满的是这一份
  const inner = await frame.evaluate((el) => el.clientWidth)
  // 产品定的宽度上限。手机这一档（380）本来就在上限以内，真正卡住它的是桌面
  expect(inner, `${where}：展示位宽度上限是 500px`).toBeLessThanOrEqual(500)
  const shots = await page.locator('.sponsor__img').evaluateAll((els) =>
    els.map((el) => {
      const img = el as HTMLImageElement
      return {
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        width: img.getBoundingClientRect().width,
      }
    }),
  )

  expect(shots.length, `${where}：展示位渲染了，却一张图都没量到`).toBeGreaterThan(0)
  for (const shot of shots) {
    expect(shot.width, `${where}：图片要铺满内容区宽度，不能按什么上限缩回去`).toBeCloseTo(inner, 0)
  }

  /*
    框的高度取**最高的那一张**：slick 的轨道是一行浮动，框把最高的一张兜住，
    矮的图在下面留白。所以按比例算出来的高度取 max，与具体张数无关。
  */
  const tallest = Math.max(...shots.map((s) => (inner * s.naturalHeight) / s.naturalWidth))
  const frameHeight = await frame.evaluate((el) => el.clientHeight)
  expect(
    Math.abs(frameHeight - tallest),
    `${where}：画面高度应当是「宽度 ÷ 最高那张图的比例」（88–160px 那套上限已经作废）`,
  ).toBeLessThanOrEqual(2)
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
   * 赞助位（§7.7）**不再为「一屏」让位**。
   *
   * 上一版把它做成一份「页面剩余空间」的预算（88–160px），这条用例断言的就是
   * 那份预算算得对。产品现在的口径是**赞助图尽量大、允许页面出现滚动条**，
   * 预算作废，于是这条用例改守新规则（见 expectSponsorSizing）。
   *
   * 没有赞助图时**依然守着「一屏放得下」**：那条要求（§7.3：一分钟内完成打卡、
   * 关键信息一屏看完）今天没有任何 CSS 强制 —— 容器是 min-height: 100vh，
   * 页面不滚全靠内容比视口短。CI 与任何没放图的机器走的就是这一支。
   */
  test('412×839：赞助位铺满宽度、按原图比例放大，页面该滚就滚', async ({ page }) => {
    await openAt(page, PHONE_VIEWPORT, '/home')
    await expectSponsorSizing(page, '首页', '.track-grid')

    await page.goto('/me')
    await expectSponsorSizing(page, '「我的」页', '.ant-descriptions')
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

    /*
      赞助位（§7.7）的宽度上限在这一档才起作用：手机内容区只有 380px，
      桌面首页是 992px。收在 500 之后**要居中** —— 贴左、右侧空一片像坏掉了。
      居中对象是那一列内容（壳 1040、页内边距 24），中心与整页中心重合。
    */
    const sponsor = await page.locator('.sponsor').boundingBox()
    expect(sponsor!.width, '桌面这一档应当正好卡在上限上').toBe(500)
    expect(sponsor!.x + sponsor!.width / 2, '赞助位应当在内容列里居中').toBe(640)
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
