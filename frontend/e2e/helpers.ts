import type { Page } from '@playwright/test'
import { makePng } from '../tools/png.mjs'

export const PARTICIPANT_PASSWORD = 'DevPassw0rd!'

/**
 * **今天还没有打卡**的参赛者，每个提交类用例各用一个。
 *
 * 播种脚本会给大部分参赛者提交今天的记录，只有 index % 7 === 6 的被整个跳过，
 * 也就是 2026007 / 2026014 / 2026021。打卡流程必须用还没打卡的账号，
 * 否则三张卡片全是「待审核」，根本没有「去打卡」可点。
 *
 * 之所以要**一人一个**而不是共用一个：用例会互相留下待审核记录，
 * 而「重新提交」按钮是按顺序取的第一个 —— 共用账号时很容易点到别的用例
 * 留下的那条，于是断言「第 2 版」时看到的是另一条赛道的第 1 版。
 * 这类跨用例干扰表现为莫名其妙的断言失败，查起来很费劲。
 *
 * 确实与播种脚本的实现耦合。宁可这样，也不要写成「找不到可打卡的赛道就跳过」——
 * 那种写法在播种逻辑变化后会静默地什么都不测。
 */
export const FRESH_PARTICIPANTS = ['2026007', '2026014', '2026021'] as const

/** 第一个未打卡账号，用于不产生新记录的用例 */
export const FRESH_PARTICIPANT = FRESH_PARTICIPANTS[0]

/** 一个今天已经打过卡的参赛者 */
export const SUBMITTED_PARTICIPANT = '2026001'

export async function login(page: Page, studentId: string, password = PARTICIPANT_PASSWORD): Promise<void> {
  await page.goto('/login')
  // antd 的 Form.Item name 会变成 input 的 id
  await page.locator('#student_id').fill(studentId)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /登\s*录/ }).click()
  await page.waitForURL('**/home')
}

/** 一张真实可解码的 PNG，用于走完整个上传流水线 */
export function testImage(width = 400, height = 300, seed = 0) {
  return {
    name: `proof-${seed}.png`,
    mimeType: 'image/png',
    buffer: makePng(width, height, [40 + seed * 60, 120, 200]) as Buffer,
  }
}

/** 等页面上的骨架屏消失（数据加载完成） */
export async function waitForContent(page: Page): Promise<void> {
  await page.waitForSelector('.ant-skeleton', { state: 'detached', timeout: 15_000 }).catch(() => {
    // 有些页面本来就没有骨架屏，忽略
  })
}
