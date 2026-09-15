import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OVERALL_TRACK_SENTINEL } from '../../src/config/constants.js'
import { getPrismaClient } from '../../src/db/client.js'
import { generateSnapshot, freezeSnapshot } from '../../src/services/snapshot.service.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.15 最终冻结后，普通审核操作不能继续改变最终排行榜。
 * design.md §9.2 活动结束时管理员需要先清空待审核队列，再生成并冻结最终榜单。
 */
describe('最终榜单冻结', () => {
  const db = getPrismaClient()
  const CUTOFF = '2026-10-03'

  let campaignId: string
  let trackId: string
  let participantId: string
  let adminId: string
  let adminToken: string
  let reviewerToken: string

  beforeEach(async () => {
    freezeTimeAt(cst('2026-10-04', '10:00:00'))

    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    campaignId = campaign.id
    trackId = tracks[0]!.id

    const student = await createUser({ studentId: '2026001', name: '张三' })
    participantId = (await createParticipant({ campaignId, userId: student.id })).id

    adminId = (await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })).id
    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
    reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken

    // 一条已通过记录，构成初始榜单
    await createEntry({
      campaignId,
      participantId,
      trackId,
      activityDate: '2026-10-01',
      status: 'approved',
      reviewedAt: new Date('2026-10-01T12:00:00Z'),
    })
  })

  afterEach(() => {
    unfreezeTime()
  })

  async function rowsOf(snapshotId: string): Promise<string> {
    const rows = await db.leaderboardRow.findMany({
      where: { snapshotId },
      orderBy: [{ trackId: 'asc' }, { rank: 'asc' }, { participantId: 'asc' }],
      select: { trackId: true, participantId: true, rank: true, score: true, validDays: true, reachedAt: true },
    })
    return JSON.stringify(rows)
  }

  it('冻结后通过审核接口新增记录，最终榜单保持不变', async () => {
    const generated = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const before = await rowsOf(generated.snapshotId)

    await freezeSnapshot({ campaignId, cutoffDate: CUTOFF, frozenBy: adminId })
    const frozenRow = await db.leaderboardSnapshot.findUniqueOrThrow({ where: { id: generated.snapshotId } })
    expect(frozenRow.isFinal).toBe(true)
    expect(frozenRow.frozenAt).not.toBeNull()

    // 冻结之后再产生一条 10-02 的待审核记录并通过它 —— 这是审核流程的正常动作，
    // 但它不得改写已经冻结的榜单行
    const { entry } = await createEntry({
      campaignId,
      participantId,
      trackId,
      activityDate: '2026-10-02',
      status: 'pending',
    })

    const approved = await authed(reviewerToken)
      .post(`/api/v1/admin/reviews/${entry.id}/approve`)
      .send({ version: entry.version })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)

    expect(await rowsOf(generated.snapshotId)).toBe(before)
  })

  it('冻结后重算被拒绝', async () => {
    await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    await freezeSnapshot({ campaignId, cutoffDate: CUTOFF, frozenBy: adminId })

    const response = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/rebuild')
      .send({ cutoff_date: CUTOFF, reason: '试图改写已冻结的榜单' })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('SNAPSHOT_FINALIZED')
  })

  it('仍有待审核记录时不允许冻结（§9.2 先清空队列）', async () => {
    await createEntry({
      campaignId,
      participantId,
      trackId,
      activityDate: '2026-10-02',
      status: 'pending',
    })
    await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    const response = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/freeze')
      .send({ cutoff_date: CUTOFF, reason: '活动结束，准备冻结' })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PENDING_REVIEWS_REMAIN')
    expect(response.body.details.pending_count).toBe(1)

    // 前置条件不满足时不产生任何副作用
    const snapshot = await db.leaderboardSnapshot.findFirstOrThrow({ where: { campaignId, cutoffDate: CUTOFF } })
    expect(snapshot.isFinal).toBe(false)
  })

  it('清空待审核队列后可以正常冻结', async () => {
    const { entry } = await createEntry({
      campaignId,
      participantId,
      trackId,
      activityDate: '2026-10-02',
      status: 'pending',
    })

    const rejected = await authed(reviewerToken)
      .post(`/api/v1/admin/reviews/${entry.id}/reject`)
      .send({ version: entry.version, reason_code: 'incomplete_proof', reason: '证明材料不完整' })
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)

    await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    const response = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/freeze')
      .send({ cutoff_date: CUTOFF, reason: '队列已清空，冻结最终榜单' })

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.is_final).toBe(true)
  })

  it('解冻之后才能重算，且冻结动作写入审计', async () => {
    await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    // 走接口而不是直接调 freezeSnapshot：审计记录是路由写的，
    // 直接调服务会绕过它，测出来的「没有审计」是假象
    const freeze = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/freeze')
      .send({ cutoff_date: CUTOFF, reason: '活动结束，冻结最终榜单' })
    expect(freeze.status, JSON.stringify(freeze.body)).toBe(200)

    const unfreeze = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/unfreeze')
      .send({ cutoff_date: CUTOFF, reason: '发现漏审记录，需要重新计算' })
    expect(unfreeze.status, JSON.stringify(unfreeze.body)).toBe(200)

    const rebuild = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/rebuild')
      .send({ cutoff_date: CUTOFF, reason: '解冻后重算' })
    expect(rebuild.status, JSON.stringify(rebuild.body)).toBe(200)

    const actions = await db.auditLog.findMany({
      where: { action: { in: ['leaderboard.freeze', 'leaderboard.unfreeze', 'leaderboard.rebuild'] } },
      select: { action: true, actorId: true, afterData: true },
    })
    expect(actions.map((action) => action.action).sort()).toEqual([
      'leaderboard.freeze',
      'leaderboard.rebuild',
      'leaderboard.unfreeze',
    ])
    for (const action of actions) {
      expect(action.actorId).toBe(adminId)
      expect(action.afterData).toContain('reason')
    }
  })

  it('冻结不会影响其他统计截止日的快照', async () => {
    const early = await generateSnapshot({ campaignId, cutoffDate: '2026-10-01' })
    await freezeSnapshot({ campaignId, cutoffDate: '2026-10-01', frozenBy: adminId })

    // 另一天仍可正常生成
    const later = await generateSnapshot({ campaignId, cutoffDate: '2026-10-02' })
    expect(later.snapshotId).not.toBe(early.snapshotId)
    expect(await db.leaderboardSnapshot.count({ where: { campaignId } })).toBe(2)

    const snapshots = await db.leaderboardSnapshot.findMany({
      where: { campaignId },
      select: { cutoffDate: true, isFinal: true },
      orderBy: { cutoffDate: 'asc' },
    })
    expect(snapshots).toEqual([
      { cutoffDate: '2026-10-01', isFinal: true },
      { cutoffDate: '2026-10-02', isFinal: false },
    ])
  })

  it('总榜哨兵行同样被冻结保护', async () => {
    const generated = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const overallBefore = await db.leaderboardRow.findMany({
      where: { snapshotId: generated.snapshotId, trackId: OVERALL_TRACK_SENTINEL },
    })
    expect(overallBefore).toHaveLength(1)

    await freezeSnapshot({ campaignId, cutoffDate: CUTOFF, frozenBy: adminId })

    const overallAfter = await db.leaderboardRow.findMany({
      where: { snapshotId: generated.snapshotId, trackId: OVERALL_TRACK_SENTINEL },
    })
    expect(JSON.stringify(overallAfter)).toBe(JSON.stringify(overallBefore))
  })
})
