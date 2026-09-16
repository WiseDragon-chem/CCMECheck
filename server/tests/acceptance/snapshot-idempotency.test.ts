import { beforeEach, describe, expect, it } from 'vitest'
import { OVERALL_TRACK_SENTINEL } from '../../src/config/constants.js'
import { AppError } from '../../src/core/errors.js'
import { getPrismaClient } from '../../src/db/client.js'
import { generateSnapshot, resolveCronCutoffDate } from '../../src/services/snapshot.service.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'

/**
 * design.md §16.9 06:00 定时任务重复执行不会生成重复快照。
 * design.md §9.2 幂等性由 (campaign_id, cutoff_date) 唯一约束 + 先删后插保证。
 */
describe('排行榜快照幂等性', () => {
  const db = getPrismaClient()
  const CUTOFF = '2026-10-03'

  let campaignId: string
  let adminToken: string
  let participantIds: string[]

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    campaignId = campaign.id

    adminToken = (await login(await seedAdmin(), TEST_PASSWORD)).accessToken
    void adminToken

    participantIds = []
    // 三个参赛者，各自在不同活动日通过若干记录，便于产生有区分度的名次
    for (const [index, studentId] of ['2026001', '2026002', '2026003'].entries()) {
      const user = await createUser({ studentId, name: `参赛者${index + 1}` })
      const participant = await createParticipant({ campaignId, userId: user.id })
      participantIds.push(participant.id)

      for (const [dayIndex, activityDate] of ['2026-10-01', '2026-10-02', '2026-10-03'].entries()) {
        // 参赛者 1 三天全打，2 打两天，3 打一天 —— 名次应当稳定为 1 > 2 > 3
        if (dayIndex > 2 - index) continue
        for (const track of tracks) {
          await createEntry({
            campaignId,
            participantId: participant.id,
            trackId: track.id,
            activityDate,
            status: 'approved',
            reviewedAt: new Date(`${activityDate}T12:00:00Z`),
          })
        }
      }
    }
  })

  async function seedAdmin(): Promise<string> {
    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    return 'admin1'
  }

  async function snapshotRows(snapshotId: string) {
    const rows = await db.leaderboardRow.findMany({
      where: { snapshotId },
      orderBy: [{ trackId: 'asc' }, { rank: 'asc' }, { participantId: 'asc' }],
      select: { trackId: true, participantId: true, rank: true, score: true, validDays: true, reachedAt: true },
    })
    return JSON.stringify(rows)
  }

  it('同一统计截止日重复执行只保留一份快照，行内容逐字节一致', async () => {
    const first = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const firstRows = await snapshotRows(first.snapshotId)

    const second = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const third = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    // 三次执行始终落在同一行上
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(third.snapshotId).toBe(first.snapshotId)
    expect(await db.leaderboardSnapshot.count({ where: { campaignId, cutoffDate: CUTOFF } })).toBe(1)

    // 后两次是「重算已有快照」而不是新建
    expect(first.regenerated).toBe(false)
    expect(second.regenerated).toBe(true)

    // 行内容完全一致：先删后插保证不会累加或留下重复行
    expect(await snapshotRows(first.snapshotId)).toBe(firstRows)
  })

  it('快照同时产出分赛道榜与总榜哨兵行', async () => {
    const result = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const rows = await db.leaderboardRow.findMany({ where: { snapshotId: result.snapshotId } })

    const trackIds = new Set(rows.map((row) => row.trackId))
    expect(trackIds).toContain('reading')
    expect(trackIds).toContain('vocabulary')
    expect(trackIds).toContain('fitness')
    expect(trackIds).toContain(OVERALL_TRACK_SENTINEL)

    // 总榜每个参赛者一行
    const overall = rows.filter((row) => row.trackId === OVERALL_TRACK_SENTINEL)
    expect(overall).toHaveLength(participantIds.length)

    // 名次按积分降序：打卡三天的人排第一
    const sorted = [...overall].sort((a, b) => a.rank - b.rank)
    expect(sorted[0]!.validDays).toBeGreaterThanOrEqual(sorted[sorted.length - 1]!.validDays)
  })

  it('只统计截止日（含）之前、且已审核通过的记录', async () => {
    // 截止日之后补一条通过记录
    await createEntry({
      campaignId,
      participantId: participantIds[2]!,
      trackId: (await db.track.findFirstOrThrow({ where: { slug: 'reading' } })).id,
      activityDate: '2026-10-05',
      status: 'approved',
      reviewedAt: new Date('2026-10-05T12:00:00Z'),
    })

    const result = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    const row = await db.leaderboardRow.findFirstOrThrow({
      where: { snapshotId: result.snapshotId, trackId: 'reading', participantId: participantIds[2]! },
    })

    // 10-05 的记录不在 cutoff 之内，只有 10-03 那天算数
    expect(row.validDays).toBe(1)
  })

  it('06:00 任务使用的截止日不超过活动结束日，也不早于开始日', () => {
    const campaign = { startDate: '2026-10-01', endDate: '2026-10-07' }

    // 活动中：统计前一天
    expect(resolveCronCutoffDate(campaign, new Date('2026-10-04T06:00:00+08:00'))).toBe('2026-10-03')
    // 活动已结束后封顶到结束日
    expect(resolveCronCutoffDate(campaign, new Date('2026-11-20T06:00:00+08:00'))).toBe('2026-10-07')
    // 活动开始前无事可做
    expect(resolveCronCutoffDate(campaign, new Date('2026-10-01T06:00:00+08:00'))).toBeNull()
  })

  it('管理员通过接口重算同样复用同一份快照', async () => {
    const initial = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    const response = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/rebuild')
      .send({ cutoff_date: CUTOFF, reason: '审核完成后重算' })

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.snapshot_id).toBe(initial.snapshotId)
    expect(response.body.regenerated).toBe(true)
    expect(await db.leaderboardSnapshot.count({ where: { campaignId, cutoffDate: CUTOFF } })).toBe(1)
  })

  it('管理员手动触发的 leaderboard_rebuild 任务重算的是当前活动的最新一份快照（§14）', async () => {
    const initial = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })

    // §14 把「重算排行榜」列为任务，且只接受管理员触发
    const response = await authed(adminToken).post('/api/v1/admin/jobs/leaderboard_rebuild/run')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.status).toBe('success')
    expect(response.body.processed).toBeGreaterThan(0)

    // 未指定截止日时落在已有快照上，而不是另建一份
    const snapshots = await db.leaderboardSnapshot.findMany({ where: { campaignId } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.id).toBe(initial.snapshotId)

    const run = await db.jobRun.findFirstOrThrow({ where: { jobName: 'leaderboard_rebuild' } })
    expect(run.trigger).toBe('manual')
    expect(run.status).toBe('success')
  })

  it('重算必须填写原因（§8.5 所有异常操作留痕）', async () => {
    const response = await authed(adminToken)
      .post('/api/v1/admin/leaderboards/rebuild')
      .send({ cutoff_date: CUTOFF, reason: '' })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })

  it('冻结的快照不接受重算', async () => {
    const result = await generateSnapshot({ campaignId, cutoffDate: CUTOFF })
    await db.leaderboardSnapshot.update({
      where: { id: result.snapshotId },
      data: { isFinal: true, frozenAt: new Date() },
    })

    await expect(generateSnapshot({ campaignId, cutoffDate: CUTOFF })).rejects.toMatchObject({
      code: 'SNAPSHOT_FINALIZED',
    })
    await expect(generateSnapshot({ campaignId, cutoffDate: CUTOFF })).rejects.toBeInstanceOf(AppError)
  })
})
