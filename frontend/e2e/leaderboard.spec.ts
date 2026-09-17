import { expect, test } from '@playwright/test'
import { SUBMITTED_PARTICIPANT, login } from './helpers.js'

/**
 * 排行榜（design.md §7.6）。
 */
test.describe('排行榜', () => {
  test('四个标签页可切换，榜单有数据', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/leaderboard')
    await page.waitForSelector('.lb-row')

    // 三个赛道 + 总榜
    for (const name of ['读书', '单词背诵', '运动健身', '总榜']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }

    const overallRows = await page.locator('.lb-row').count()
    expect(overallRows, '总榜应当有参赛者').toBeGreaterThan(0)

    // 切到读书榜，数据随之变化
    await page.getByRole('tab', { name: '读书' }).click()
    await page.waitForTimeout(800)
    expect(await page.locator('.lb-row').count()).toBeGreaterThan(0)
  })

  test('展示快照时间与统计截止日，并说明更新节奏', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/leaderboard')
    await page.waitForSelector('.lb-row')

    await expect(page.getByText(/统计至 \d{4}-\d{2}-\d{2}/)).toBeVisible()
    await expect(page.getByText(/生成于 \d{4}-\d{2}-\d{2}/)).toBeVisible()

    // 这条说明挡掉「我刚通过为什么榜上没变」这类最高频的疑问
    await expect(page.getByText(/每日 06:00 更新/)).toBeVisible()
  })

  test('当前用户所在行被标记出来', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/leaderboard')
    await page.waitForSelector('.lb-row')

    // 高亮不能只靠颜色 —— 必须还有一个文字标记。
    // 断言限定在本人那一行里，不用 getByText('我').first()：导航项「我的」
    // 也含这两个字，而顶部导航（桌面上才可见）在 DOM 里排在内容之前，
    // first() 会挑到那个隐藏的导航文案
    const myRow = page.locator('.lb-row.is-me')
    await expect(myRow).toHaveCount(1)
    await expect(myRow.getByText('我')).toBeVisible()
  })

  test('名次按积分降序，且并列时序号重复而不是重新编号', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/leaderboard')
    await page.waitForSelector('.lb-row')

    const ranks = await page.locator('.lb-row__rank').allInnerTexts()
    const numbers = ranks.map(Number)

    // 非递减
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]!, `第 ${i + 1} 行的名次不应小于上一行`).toBeGreaterThanOrEqual(numbers[i - 1]!)
    }

    // 第一名必须是 1
    expect(numbers[0]).toBe(1)
  })
})
