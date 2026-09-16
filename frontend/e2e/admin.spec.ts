import { expect, test, type Page } from '@playwright/test'

/**
 * 管理后台：流水线审核（design.md §8.2）。
 *
 * 这一屏的全部价值在键盘流上，而键盘流恰恰是单元测试碰不到的部分 ——
 * 「按 A 通过之后光标有没有前进」「弹窗开着时按 J 会不会切走记录」
 * 只有真的在浏览器里按下去才知道。
 *
 * 后台是**桌面优先**的界面（§10.1），所以这个文件跑在 desktop 项目里
 * （见 playwright.config.ts）—— 用手机尺寸测三栏布局测不出它的真实行为。
 */

const REVIEWER = { studentId: 'reviewer', password: 'reviewer12345' }
const ADMIN = { studentId: 'admin', password: 'admin12345' }
const PARTICIPANT = { studentId: '2026001', password: 'DevPassw0rd!' }

async function loginAs(page: Page, who: { studentId: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.locator('#student_id').fill(who.studentId)
  await page.locator('#password').fill(who.password)
  await page.getByRole('button', { name: /登\s*录/ }).click()
}

/** 登录并直接进审核页。审核员登录后落在概览，审核页要再走一步 */
async function openReview(page: Page): Promise<void> {
  await loginAs(page, REVIEWER)
  await page.waitForURL('**/admin')
  await page.goto('/admin/review')
  await expect(page.locator('.queue-item').first()).toBeVisible()
}

/** 当前光标所在的那条记录的名字 */
function currentEntry(page: Page) {
  return page.locator('.queue-item.is-current .queue-item__name')
}

/** 进度条上的某个数字。标签与数值在同一个单元格里 */
function progressValue(page: Page, label: string) {
  return page.locator('.queue-progress__cell', { hasText: label }).locator('.queue-progress__value')
}

test.describe('管理后台', () => {
  test('审核员登录后直接落到后台，而不是参赛者主页', async ({ page }) => {
    await loginAs(page, REVIEWER)
    // 审核员是来干活的，不是来打卡的（见 routes/roles.ts）
    await page.waitForURL('**/admin')

    await expect(page.getByText('各赛道今日提交率')).toBeVisible()

    // 从导航进审核页
    await page.locator('.ant-menu-item', { hasText: '审核' }).click()
    await expect(page.locator('.review-pipeline')).toBeVisible()
    await expect(page.locator('.queue-item').first()).toBeVisible()
  })

  test('参赛者敲 /admin 会被挡回主页，而不是看到一个空后台', async ({ page }) => {
    await loginAs(page, PARTICIPANT)
    await page.waitForURL('**/home')

    await page.goto('/admin')
    // 允许进入的话会是一个空壳页面，用户不知道该干什么
    await page.waitForURL('**/home')
  })

  test('按 A 通过当前记录：光标前进，今日通过数增加', async ({ page }) => {
    await openReview(page)

    const before = await currentEntry(page).innerText()
    const approvedBefore = Number(await progressValue(page, '今日通过').innerText())

    await page.keyboard.press('a')

    await expect(page.locator('.ant-message')).toContainText('已通过')

    // 已决的那条从可见队列里消失，光标落到下一条上
    await expect(currentEntry(page)).not.toHaveText(before)
    await expect
      .poll(async () => Number(await progressValue(page, '今日通过').innerText()))
      .toBe(approvedBefore + 1)
  })

  test('按 R 打开驳回面板，数字键选原因，Enter 确认', async ({ page }) => {
    await openReview(page)

    const before = await currentEntry(page).innerText()

    await page.keyboard.press('r')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('驳回原因')

    // 数字键选中预设原因（理由码与原因一一对应，见 RejectModal）
    await page.keyboard.press('1')
    await expect(dialog.locator('.ant-radio-wrapper-checked')).toHaveCount(1)

    await page.keyboard.press('Enter')

    await expect(page.locator('.ant-message')).toContainText('已驳回')
    await expect(currentEntry(page)).not.toHaveText(before)
  })

  test('驳回面板打开时 J / A 都不生效 —— 否则填原因的过程中会审掉别的记录', async ({ page }) => {
    await openReview(page)

    const before = await currentEntry(page).innerText()

    await page.keyboard.press('r')
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('j')
    await page.keyboard.press('a')

    // 光标停在原处，也没有出现任何审核结果
    await expect(currentEntry(page)).toHaveText(before)
    await expect(page.locator('.ant-message')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('概览页把首页要的数字一次给全', async ({ page }) => {
    await loginAs(page, REVIEWER)
    await page.waitForURL('**/admin')

    await page.locator('.ant-menu-item', { hasText: '概览' }).click()
    await page.waitForURL('**/admin')

    await expect(page.locator('.ant-statistic', { hasText: '参赛人数' })).toBeVisible()
    await expect(page.locator('.ant-statistic', { hasText: '待审核' })).toBeVisible()
    await expect(page.getByText('各赛道今日提交率')).toBeVisible()
    // 距下次排行榜更新是首页唯一定时刷新的数字
    await expect(page.getByText('距下次排行榜更新')).toBeVisible()
  })

  test('异常处理与审计日志只对超管可见', async ({ page }) => {
    await loginAs(page, REVIEWER)
    await page.waitForURL('**/admin')

    // 审核员不该看到这两个入口（§5）。隐藏不是权限控制，
    // 真正的边界在后端 —— 但入口露出来会让人以为自己点错了
    await expect(page.locator('.ant-menu-item', { hasText: '异常处理' })).toHaveCount(0)
    await expect(page.locator('.ant-menu-item', { hasText: '审计日志' })).toHaveCount(0)

    await page.goto('/admin/ops')
    // 手敲 URL 进来会被挡回后台首页（路由上再挡一道，不只是隐藏入口）
    await page.waitForURL('**/admin')
  })
})

/**
 * 名单管理（§8.3）。
 *
 * 这一页里最该被端到端验证的是**导入**：预览与正式导入用的是服务端
 * 同一次计算的结论，中间隔着一次文件暂存与重新解析 ——
 * 任何一处对不上，管理员看到的就是「预览说没问题、导入却少了几个人」。
 *
 * 其次是激活码：它只在响应里出现一次，服务端只存哈希。
 * 界面上少一个入口（比如被塞进 3 秒就消失的 toast），
 * 后果是这批人的码要全部重新生成。
 */
test.describe('名单管理', () => {
  /** 一份用于导入的 CSV：一行正常、一行姓名为空 */
  function rosterCsv(): Buffer {
    const csv = [
      'student_id,name,class_name,phone_suffix,remark',
      'E2E9001,测试新人,化学院2026级,1234,',
      'E2E9002,,化学院2026级,,',
    ].join('\r\n')
    return Buffer.from(`﻿${csv}`, 'utf8')
  }

  async function openRoster(page: Page): Promise<void> {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')
    await page.goto('/admin/participants')
    await expect(page.locator('.ant-table-row').first()).toBeVisible()
  }

  test('名单页展示参赛者，能按学号搜索', async ({ page }) => {
    await openRoster(page)

    const before = await page.locator('.ant-table-row').count()
    expect(before).toBeGreaterThan(0)

    await page.getByPlaceholder('按学号或姓名搜索').fill('2026001')
    await page.keyboard.press('Enter')

    await expect(page.locator('.ant-table-row').first()).toContainText('2026001')
    expect(await page.locator('.ant-table-row').count()).toBeLessThan(before)
  })

  test('导入名单：预览逐行标出问题，提交后弹出一次性激活码', async ({ page }) => {
    await openRoster(page)

    await page.getByRole('button', { name: '导入名单' }).click()
    // 用可访问名限定，而不是裸的 dialog：提交之后激活码那边会再叠一个对话框，
    // 裸选择器会同时命中两个（严格模式直接报错）
    const dialog = page.getByRole('dialog', { name: '导入名单' })
    await expect(dialog).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'roster.csv',
      mimeType: 'text/csv',
      buffer: rosterCsv(),
    })

    // 预览：两行里一行可导入、一行姓名为空
    await expect(dialog).toContainText('共 2 行')
    await expect(dialog).toContainText('姓名不能为空')
    await expect(dialog.locator('.ant-table-row', { hasText: 'E2E9001' })).toContainText('新建')

    await page.getByRole('button', { name: '确认导入' }).click()

    // 只新建了一个账号，另一个被跳过
    await expect(dialog).toContainText('新建 1 个账号')
    await expect(dialog).toContainText('跳过 1 行')

    // 新建账号的激活码只能在这里拿到，所以提交后应当主动弹出来
    const codeDialog = page.getByRole('dialog', { name: /只显示这一次/ })
    await expect(codeDialog).toBeVisible()
    await expect(codeDialog).toContainText('关闭后无法再查看')

    await codeDialog.getByRole('button', { name: /关\s*闭/ }).click()

    // 新账号真的进了名单。要搜出来 —— 名单按学号升序，E 开头的排在数字学号之后，
    // 第一页看不到它
    await page.getByPlaceholder('按学号或姓名搜索').fill('E2E9001')
    await page.keyboard.press('Enter')
    await expect(page.locator('.ant-table-row', { hasText: 'E2E9001' })).toBeVisible()
    await expect(page.locator('.ant-table-row', { hasText: 'E2E9001' })).toContainText('未激活')
  })

  test('重新生成激活码：先确认后果，再显示新码', async ({ page }) => {
    await openRoster(page)

    const row = page.locator('.ant-table-row', { hasText: '2026001' })
    await row.getByRole('button', { name: '重新生成激活码' }).click()

    // 会作废此前的码，所以要点确认而不是直接执行
    await expect(page.getByText('这个账号此前所有未使用的激活码会立即作废')).toBeVisible()
    await page.getByRole('button', { name: /确\s*认/ }).click()

    const dialog = page.getByRole('dialog', { name: /只显示这一次/ })
    await expect(dialog).toBeVisible()
    // 10 位十六进制
    await expect(dialog.locator('input[readonly]')).toHaveValue(/^[0-9A-F]{10}$/)
  })

  test('禁用参赛者：确认后状态变为已禁用', async ({ page }) => {
    await openRoster(page)

    const row = page.locator('.ant-table-row', { hasText: '2026002' })
    await expect(row).toContainText('在册')

    await row.getByRole('button', { name: '禁用' }).click()
    await expect(page.getByText('该账号将无法登录')).toBeVisible()
    await page.getByRole('button', { name: /确\s*认/ }).click()

    await expect(page.locator('.ant-table-row', { hasText: '2026002' })).toContainText('已禁用')
  })
})

/**
 * 超管专属的两页（§8.3、§12.4）。
 *
 * 这两页没有测试账号之外的访问路径，也不参与任何自动流程 ——
 * 不在这里过一遍，它们的第一次运行就是活动期间管理员点开它们的那一刻。
 */
test.describe('异常处理与审计日志', () => {
  test('异常处理的每个操作都要填完表单、填了原因才能提交', async ({ page }) => {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')

    await page.locator('.ant-menu-item', { hasText: '异常处理' }).click()
    await page.waitForURL('**/admin/ops')

    // 六个操作齐全：补录、积分调整、重开、撤销、作废、以及排行榜维护的三个
    for (const title of ['管理员补录', '积分调整', '重新开放', '撤销审核结果', '作废记录']) {
      await expect(page.locator('.ant-card-head-title', { hasText: title })).toBeVisible()
    }
    await expect(page.getByText('排行榜维护')).toBeVisible()

    /*
      表单没填完时按钮是禁用的 —— 这不是装饰：这些操作全部不可逆，
      让管理员填完一屏表单再被服务端打回来是最差的顺序。

      按钮名用正则而不是字面量：antd 会在两个汉字之间插一个空格
      （`执 行`），写死「执行」会等不到元素 —— 参赛者端的用例
      同样用 /登\s*录/ 绕开它。
    */
    const submitButtons = page.getByRole('button', { name: /执\s*行/ })
    await expect(submitButtons.first()).toBeDisabled()

    // 补录：选完参赛者、赛道、活动日之后才可用
    const manualCard = page.locator('.ant-card', { hasText: '管理员补录' }).first()
    await expect(manualCard.getByRole('button', { name: /执\s*行/ })).toBeDisabled()
  })

  test('贴一个查不到的记录 ID 时明确说「没找到」，而不是让表单静默地不可用', async ({ page }) => {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')
    await page.goto('/admin/ops')

    const revokeCard = page.locator('.ant-card', { hasText: '撤销审核结果' }).first()
    await revokeCard.getByPlaceholder('从审核页复制记录 ID').fill('entry_does_not_exist')

    // 记录 ID 抄错是这一屏最贵的错误 —— 必须当场说清楚，而不是等提交后报一个外键错误
    await expect(revokeCard.getByText('没找到这条记录')).toBeVisible()
    await expect(revokeCard.getByRole('button', { name: /执\s*行/ })).toBeDisabled()
  })

  test('审计日志展示操作、操作人与修改前后', async ({ page }) => {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')
    await page.goto('/admin/audit')

    // 播种与前面的用例都留下了审计记录
    await expect(page.locator('.ant-table-row').first()).toBeVisible()

    // 动作列同时给出中文名与原始动作码：与后端日志对照时要用后者
    await expect(page.locator('.ant-table').getByText('review.approve').first()).toBeVisible()

    // 展开一条看修改前后
    await page.locator('.ant-table-row-expand-icon').first().click()
    await expect(page.locator('.audit-diff').first()).toBeVisible()
  })

  test('审计日志按动作筛选后只剩该动作', async ({ page }) => {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')
    await page.goto('/admin/audit')
    await expect(page.locator('.ant-table-row').first()).toBeVisible()

    await page.locator('#action').fill('review.approve')
    await page.getByRole('button', { name: /查\s*询/ }).click()
    await expect(page.locator('.ant-table-row').first()).toBeVisible()

    for (const text of await page.locator('.ant-table-row').allInnerTexts()) {
      expect(text).toContain('review.approve')
    }
  })
})
