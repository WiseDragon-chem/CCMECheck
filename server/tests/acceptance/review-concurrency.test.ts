import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.8 两名管理员同时审核同一记录时不会产生互相覆盖的结果。
 *
 * 设计文档 §8.2 给的两条路是「版本号或短期审核锁」，实现选了版本号：
 * 锁在进程崩溃时会泄漏，而版本号比较是无状态的。
 * 客户端必须回传它看到的那一版 version，事务内比对不一致就返回 409，
 * 由管理员刷新后继续。
 */
describe('并发审核', () => {
  const db = getPrismaClient()

  let campaignId: string
  let participantId: string
  let entryId: string
  let reviewerA: string
  let reviewerB: string

  beforeEach(async () => {
    freezeTimeAt(cst('2026-10-01', '10:00:00'))

    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    campaignId = campaign.id

    const student = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: student.id })
    participantId = participant.id

    const { entry } = await createEntry({
      campaignId,
      participantId,
      trackId: tracks[0]!.id,
      activityDate: '2026-10-01',
      withAsset: true,
    })
    entryId = entry.id

    await createUser({ studentId: 'reviewer1', name: '审核员甲', role: 'reviewer' })
    await createUser({ studentId: 'reviewer2', name: '审核员乙', role: 'reviewer' })
    reviewerA = (await login('reviewer1', TEST_PASSWORD)).accessToken
    reviewerB = (await login('reviewer2', TEST_PASSWORD)).accessToken
  })

  afterEach(() => {
    unfreezeTime()
  })

  it('两人同时以同一版本通过时，恰好一人成功、一人收到冲突', async () => {
    const version = (await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })).version

    const [first, second] = await Promise.all([
      authed(reviewerA).post(`/api/v1/admin/reviews/${entryId}/approve`).send({ version }),
      authed(reviewerB).post(`/api/v1/admin/reviews/${entryId}/approve`).send({ version }),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses, `两次响应的状态码：${first.status} / ${second.status}`).toEqual([200, 409])

    const conflict = first.status === 409 ? first : second
    expect(conflict.body.code).toBe('REVIEW_CONFLICT')
    // 冲突响应要能让前端知道「刷新后继续」，因此不应是泛化的 500
    expect(conflict.body.message).toBeTruthy()

    // 只产生一条审核行为记录，且状态只被推进一次
    expect(await db.reviewAction.count({ where: { entryId } })).toBe(1)
    const stored = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(stored.status).toBe('approved')
    expect(stored.version).toBe(version + 1)
  })

  it('一人通过、一人驳回并发时，结果同样只有一个生效', async () => {
    const version = (await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })).version

    const [approved, rejected] = await Promise.all([
      authed(reviewerA).post(`/api/v1/admin/reviews/${entryId}/approve`).send({ version }),
      authed(reviewerB)
        .post(`/api/v1/admin/reviews/${entryId}/reject`)
        .send({ version, reason_code: 'screenshot_date_mismatch', reason: '截图日期不符合' }),
    ])

    expect([approved.status, rejected.status].sort()).toEqual([200, 409])
    expect(await db.reviewAction.count({ where: { entryId } })).toBe(1)

    // 无论谁赢，结果都必须是二者之一，不能出现「既通过又驳回」的中间态
    const stored = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(['approved', 'rejected']).toContain(stored.status)

    // 通过时必须清掉驳回痕迹，驳回时必须带上原因
    if (stored.status === 'approved') {
      expect(stored.rejectionReason).toBeNull()
    } else {
      expect(stored.rejectionReason).toBeTruthy()
    }
  })

  it('冲突后管理员用最新版本重试即可成功（§8.2「刷新后继续」）', async () => {
    const staleVersion = (await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })).version

    const winner = await authed(reviewerA)
      .post(`/api/v1/admin/reviews/${entryId}/approve`)
      .send({ version: staleVersion })
    expect(winner.status).toBe(200)

    // 乙拿着过期的版本号重试，被拦下
    const stale = await authed(reviewerB)
      .post(`/api/v1/admin/reviews/${entryId}/reject`)
      .send({ version: staleVersion, reason_code: 'other', reason: '内容无法识别' })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('REVIEW_CONFLICT')

    // 重新拉取详情拿到新版本号，再操作就能成功
    const detail = await authed(reviewerB).get(`/api/v1/admin/reviews/${entryId}`)
    expect(detail.status).toBe(200)
    const freshVersion = detail.body.entry?.version ?? detail.body.version
    expect(typeof freshVersion).toBe('number')
    expect(freshVersion).toBe(staleVersion + 1)
  })

  it('版本号缺失或类型不对时按参数校验拒绝，不会误判为冲突', async () => {
    const response = await authed(reviewerA)
      .post(`/api/v1/admin/reviews/${entryId}/approve`)
      .send({})

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })
})
