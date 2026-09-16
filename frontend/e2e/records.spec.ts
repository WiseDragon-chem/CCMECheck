import { expect, test } from '@playwright/test'
import { SUBMITTED_PARTICIPANT, login } from './helpers.js'

/**
 * 打卡记录与详情（design.md §7.5）。
 *
 * 重点是「被驳回之后用户能不能看明白发生了什么」——
 * 这是参赛者最容易产生疑问、也最需要自助解决的地方。
 */
test.describe('打卡记录', () => {
  test('列表展示记录，并能筛选', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/records')
    await page.waitForSelector('.ant-card')

    const all = await page.locator('.ant-card').count()
    expect(all, '这个账号应当有若干条记录').toBeGreaterThan(0)

    // 按状态筛选
    await page.getByText('全部状态').click()
    await page.locator('.ant-select-item-option', { hasText: '已通过' }).click()
    await page.waitForTimeout(800)

    const approved = await page.locator('.ant-card').count()
    expect(approved, '筛选应当生效').toBeLessThanOrEqual(all)
    // 筛选后的每一条都应当是已通过
    for (const text of await page.locator('.ant-card').allInnerTexts()) {
      expect(text).toContain('已通过')
    }
  })

  test('筛选后没有结果时给出的是「筛选造成」而不是「没有记录」', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)
    await page.goto('/records')
    await page.waitForSelector('.ant-card')

    // 这个账号没有被作废的记录
    await page.getByText('全部状态').click()
    await page.locator('.ant-select-item-option', { hasText: '已作废' }).click()
    await page.waitForTimeout(800)

    // 两种空状态混为一谈会让用户以为数据丢了
    await expect(page.getByText(/当前筛选条件下没有记录/)).toBeVisible()
    await expect(page.getByRole('button', { name: '清除筛选' })).toBeVisible()
  })

  test('详情页展示证明材料与证明要求，图片真的能加载出来', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/records')
    await page.waitForSelector('.ant-card')
    await page.locator('.ant-card').first().click()

    await expect(page.getByText('提交信息')).toBeVisible()
    await expect(page.getByText('有效证明要求')).toBeVisible()
    await expect(page.getByText('提交时间')).toBeVisible()

    // 图片走的是签名地址，必须真的加载出来而不是裂图。
    // 断言 naturalWidth 而不是「元素存在」—— 存在只说明 DOM 里有节点，
    // 裂图同样会有一个 img 元素。
    //
    // 选择器用 .image-thumb img 而不是 img.signed-image：
    // 详情页用的是 antd 的 Image，className 落在它的外层容器上，
    // 内层真正的 img 不带那个类。
    const images = page.locator('.image-thumb img')
    await expect(images.first()).toBeVisible()
    await expect
      .poll(
        async () =>
          images.evaluateAll((nodes) =>
            nodes.filter((node) => (node as HTMLImageElement).naturalWidth > 0).length,
          ),
        { message: '签名地址应当能取回图片字节' },
      )
      .toBeGreaterThan(0)

    // 点开可以放大查看
    await page.locator('.ant-image-mask').first().click()
    await expect(page.locator('.ant-image-preview-wrap')).toBeVisible()
  })

  test('历史版本默认折叠，展开后才显示', async ({ page }) => {
    await login(page, SUBMITTED_PARTICIPANT)

    await page.goto('/records')
    await page.waitForSelector('.ant-card')

    // 播种脚本刻意让前面几条记录有多个版本，待审核的那条通常是其中之一
    await page.locator('.ant-card').filter({ hasText: '待审核' }).first().click()
    await expect(page.getByText('提交信息')).toBeVisible()

    const toggle = page.getByText(/提交历史（\d+ 个较早版本）/)
    await expect(toggle, '待审核的记录应当有历史版本').toBeVisible()

    const panel = page.locator('.ant-collapse-content').first()
    // §7.5：历史版本默认折叠
    await expect(panel).toBeHidden()

    await toggle.click()

    // 展开后能看到较早的版本，以及「以最新一次为准」的说明。
    // 用容器的 toContainText 而不是对具体句子做 getByText：
    // 文字被包在多层元素里，按整句匹配很容易落空，
    // 而这里真正要断言的是「面板展开后这些内容出现了」。
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('第 1 版 · 1 张')
    await expect(panel).toContainText('审核仅以最新一次提交为准。')
  })
})
