import type { Page } from '@playwright/test'
import { expect, test } from './helpers.js'

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
  /**
   * 申报明细与备注搬进中栏图片下方之后，中栏多了一条固定高度的块。
   *
   * 要守的约束互相拉扯：备注最长 1000 字，但它不能把图片挤没，
   * 也不能让中栏自己长出滚动条（§8.2 的三栏各自滚动的结构）。
   * 所以它必须**自己滚动** —— 这条用例守住这一点，以及需求要的
   * 「备注栏在图片下方」。
   *
   * 注意这里**不**断言 document 级滚动：审核页在 1280×720 下本来就有
   * 约 24px 的页面滚动，成因是 .review-pipeline 的
   * `calc(100vh - 56px - 32px)` 用了 56px（那是参赛者端导航的高度
   * --top-nav-height），而后台 .admin-header 实际是 80px。
   * 与本次改动无关 —— 把 .materials-note 藏起来再量，溢出仍是 24px，
   * 而且 .review-pipeline 是定高 + overflow: hidden，栏内的东西
   * 影响不到文档高度。那个偏差另有出处，见提交说明。
   */
  test('审核页 1280×720：备注栏在图片下方，且不会把图片挤没', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openReview(page)

    const stage = await page.locator('.materials-stage').boundingBox()
    const note = await page.locator('.materials-note').boundingBox()

    // 图片区仍在，且没有被备注压到看不见
    expect(stage!.height, '图片区被备注挤没了').toBeGreaterThan(120)
    // 「在图片下方」：备注的顶边在图片区顶边之下
    expect(note!.y, '备注栏跑到图片上面去了').toBeGreaterThan(stage!.y)

    // 长备注由备注块自己滚动，中栏不长出滚动条
    const columnOverflow = await page.locator('.review-pipeline__col--materials').evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )
    expect(columnOverflow, '备注把中栏撑出了滚动条').toBeLessThanOrEqual(1)
  })

  /**
   * 需求要的「用户输入的单词数量、运动类型在备注栏显示」。
   *
   * 分值梯度化之后同一个「通过」按钮对应的分值是变的，所以判定值也一并显示 ——
   * 审核员据此判断该不该通过，也顺带能看出虚报（填了 50 个但截图明显不够）。
   */
  test('备注栏显示申报明细与判定分值', async ({ page }) => {
    await openReview(page)

    // 只看单词赛道，这样队列里的记录一定带单词数量。
    // 筛选走 URL（与「队列被筛空」那条用例同一套做法），比点 antd 的下拉稳
    await page.goto('/admin/review?track=vocabulary')
    await expect(page.locator('.queue-item').first()).toBeVisible()

    const note = page.locator('.materials-note')
    await expect(note).toContainText(/单词数量：\d+ 个/)
    // 一档与二档都可能是 1 分或 2 分，这里只要求它印出来且是个整数
    await expect(note).toContainText(/本次计分：[12] 分/)
    // 备注本身也在这块里
    await expect(note).toContainText('参赛者备注')
  })

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

  test('左侧导航的选中态跟着页面走', async ({ page }) => {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')

    // 曾经这里恒为「概览」：/admin 是所有后台路径的前缀，
    // 用 find 取第一个匹配就永远命中它，点别的入口页面换了、高亮没换
    await expect(page.locator('.ant-menu-item-selected')).toContainText('概览')

    await page.locator('.ant-menu-item', { hasText: '审核' }).click()
    await page.waitForURL('**/admin/review')
    await expect(page.locator('.ant-menu-item-selected')).toContainText('审核')
    await expect(page.locator('.ant-menu-item-selected')).toHaveCount(1)

    await page.locator('.ant-menu-item', { hasText: '名单' }).click()
    await page.waitForURL('**/admin/participants')
    await expect(page.locator('.ant-menu-item-selected')).toContainText('名单')
  })

  test('队列被筛空时三个面板都不停在加载态', async ({ page }) => {
    await openReview(page)

    // 用一个查不到结果的班级把队列筛空。此时没有光标，
    // 而右栏早先的条件是「没有详情就转圈」—— 它永远等不到人来结束这个加载
    await page.goto('/admin/review?class=不存在的班级')

    await expect(page.locator('.review-pipeline__empty').first()).toBeVisible()
    await expect(page.locator('.review-pipeline .ant-skeleton')).toHaveCount(0)
    // 左栏说的是「当前筛选下没有」而不是「队列清空了」
    await expect(page.locator('.review-pipeline')).toContainText('试试清除筛选')
  })

  test('队列真的审空后，看照片的地方说「待审核队列为空」', async ({ page }) => {
    await openReview(page)

    /*
      逐条通过直到队列清空。条数取决于当次播种，上限只是兜底，
      免得一个断言写错就把用例挂成死循环。

      每按一次都等**这条真的从队列里消失**，而不是等那句「已通过」浮层：
      浮层要好几秒才消失，上一条的浮层会让断言在本次审批还没完成时就通过，
      于是按键快过请求 —— 同一条记录带着同一个版本号被提交两次，
      第二次必然 409，弹出「该记录已被其他人修改」，快捷键随之停用，
      循环空转六十次，最后留下几条没审完。这个失败看起来像「队列太长」，
      其实是断言等错了东西。

      用 poll 而不是 toHaveCount(remaining - 1)：审完一条之后队列可能
      接着加载下一页，条数不一定恰好减一，但一定会减少。
    */
    for (let guard = 0; guard < 60; guard += 1) {
      const remaining = await page.locator('.queue-item').count()
      if (remaining === 0) break
      await page.keyboard.press('a')
      await expect.poll(async () => page.locator('.queue-item').count()).toBeLessThan(remaining)
    }

    await expect(page.locator('.queue-item')).toHaveCount(0)
    // 中栏（看照片的地方）与右栏都说这件事，而不是停在加载态
    await expect(page.locator('.review-pipeline__col--materials')).toContainText('待审核队列为空')
    await expect(page.locator('.review-pipeline .ant-skeleton')).toHaveCount(0)
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

    // 审核员不该看到这几个入口（§5）。隐藏不是权限控制，
    // 真正的边界在后端 —— 但入口露出来会让人以为自己点错了
    await expect(page.locator('.ant-menu-item', { hasText: '异常处理' })).toHaveCount(0)
    await expect(page.locator('.ant-menu-item', { hasText: '审计日志' })).toHaveCount(0)
    await expect(page.locator('.ant-menu-item', { hasText: '账号' })).toHaveCount(0)

    await page.goto('/admin/ops')
    // 手敲 URL 进来会被挡回后台首页（路由上再挡一道，不只是隐藏入口）
    await page.waitForURL('**/admin')

    await page.goto('/admin/accounts')
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

/**
 * 账号管理（§5「管理管理员账号」）。
 *
 * 端到端要盯住的是**一次性明文**这条链：新建账号生成的初始密码只在响应里
 * 出现一次，界面上少一个出口（比如被塞进 3 秒就消失的 toast）就等于把它弄丢了。
 *
 * 其次是「按钮为什么点不动」。自我操作与最后一个活跃超管都会被服务端拒绝，
 * 页面上必须把原因写出来，否则灰按钮会被当成 bug。
 */
test.describe('账号管理', () => {
  const NEW_ACCOUNT = { studentId: 'E2EACC1', name: '端到端新审核员' }

  async function openAccounts(page: Page): Promise<void> {
    await loginAs(page, ADMIN)
    await page.waitForURL('**/admin')
    await page.goto('/admin/accounts')
    await expect(page.locator('.ant-table-row').first()).toBeVisible()
  }

  test('新建账号：弹出一次性密码，关掉之后能拿它登录', async ({ page }) => {
    await openAccounts(page)

    await page.getByRole('button', { name: '添加账号' }).click()
    const form = page.getByRole('dialog', { name: '添加账号' })
    await form.locator('#student_id').fill(NEW_ACCOUNT.studentId)
    await form.locator('#name').fill(NEW_ACCOUNT.name)
    await form.getByRole('button', { name: /确\s*认/ }).click()

    // 明文对话框。关闭按钮必须存在 —— 这个弹窗曾经只给一个复制按钮，
    // 遮罩又不可点关闭，管理员复制完就出不去了（见 ActivationCodeModal 的注释）
    const secretDialog = page.getByRole('dialog', { name: '临时密码（只显示这一次）' })
    await expect(secretDialog).toBeVisible()
    const password = (await secretDialog.locator('input').first().inputValue()).trim()
    expect(password.length).toBeGreaterThanOrEqual(8)

    await secretDialog.getByRole('button', { name: /关\s*闭/ }).click()

    // 新账号进了列表
    await expect(page.locator('.ant-table-row', { hasText: NEW_ACCOUNT.studentId })).toBeVisible()

    // 退出当前会话，改用新账号登录 —— 这才是「那个密码真的能用」的证明
    await page.goto('/me')
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.locator('.ant-modal-confirm').getByRole('button', { name: /^退\s*出$/ }).click()
    await page.waitForURL('**/login')

    await loginAs(page, { studentId: NEW_ACCOUNT.studentId, password })
    await page.waitForURL('**/admin')
    await expect(page.getByText('各赛道今日提交率')).toBeVisible()
  })

  test('自己对那一行的禁用与重置密码是灰的，并且页面上写明了原因', async ({ page }) => {
    await openAccounts(page)

    // 只有一个活跃超管时，页面顶部必须给出警告 —— 否则「按钮点不动」无从解释
    await expect(page.getByText('只剩一个活跃超级管理员')).toBeVisible()

    const selfRow = page.locator('.ant-table-row', { hasText: ADMIN.studentId }).first()
    await expect(selfRow.getByText('本人')).toBeVisible()

    await expect(selfRow.getByRole('button', { name: /禁\s*用/ })).toBeDisabled()
    await expect(selfRow.getByRole('button', { name: '重置密码' })).toBeDisabled()
  })
})
