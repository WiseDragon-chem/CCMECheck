import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §7.5 个人打卡记录。
 *
 * 这里守的是**非参赛者**那条分支：审核员与超管可能本身不在名单里（§5「可同时作为参赛者」），
 * 记录页对他们应当是「没有内容」而不是「没有权限」—— 报 403 的话前端只剩一个笼统的
 * FORBIDDEN 文案可用，页面会把「你不是参赛者」显示成「没有权限执行该操作」。
 */
describe('个人打卡记录', () => {
  const db = getPrismaClient()
  const ACTIVITY_DATE = '2026-10-01'

  let campaignId: string
  let participantId: string
  let token: string

  beforeEach(async () => {
    freezeTimeAt(cst(`${ACTIVITY_DATE}T10:00:00`))

    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    campaignId = campaign.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: user.id })
    participantId = participant.id

    await createEntry({
      campaignId,
      participantId,
      trackId: tracks[0]!.id,
      activityDate: ACTIVITY_DATE,
      status: 'approved',
      reviewedAt: cst(`${ACTIVITY_DATE}T12:00:00`),
    })

    token = (await login('2026001', TEST_PASSWORD)).accessToken
  })

  afterEach(() => {
    unfreezeTime()
  })

  it('参赛者看到自己的记录，并带上 is_participant', async () => {
    const response = await authed(token).get('/api/v1/checkins')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.is_participant).toBe(true)
    expect(response.body.total).toBe(1)
    expect(response.body.items[0]).toMatchObject({ activity_date: ACTIVITY_DATE, status: 'approved' })
  })

  it('非参赛者拿到空列表而不是 403，由 is_participant 表达原因', async () => {
    // 审核员/超管可能压根不在名单里 —— 不给他建 participant 行
    await createUser({ studentId: '2026002', name: '李四', role: 'super_admin' })
    const outsiderToken = (await login('2026002', TEST_PASSWORD)).accessToken

    const response = await authed(outsiderToken).get('/api/v1/checkins')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.is_participant).toBe(false)
    expect(response.body.items).toEqual([])
    expect(response.body.total).toBe(0)
    // 分页字段照常回，前端不必为这条分支另写一套
    expect(response.body.page).toBe(1)
  })

  it('参赛账号被停用后同样按非参赛者处理', async () => {
    await db.campaignParticipant.update({
      where: { id: participantId },
      data: { status: 'disabled' },
    })

    const response = await authed(token).get('/api/v1/checkins')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.is_participant).toBe(false)
    expect(response.body.items).toEqual([])
  })
})
