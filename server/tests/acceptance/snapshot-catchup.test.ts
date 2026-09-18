import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { leaderboardSnapshotJob } from '../../src/jobs/definitions/leaderboard-snapshot.job.js'
import { runStartupCatchUp } from '../../src/jobs/scheduler.js'
import { generateSnapshot } from '../../src/services/snapshot.service.js'
import { authed, login } from '../helpers/app.js'
import {
  bootstrapCampaign,
  createEntry,
  createParticipant,
  createUser,
  TEST_PASSWORD,
} from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * 漏跑的那一轮快照要在下一个整点 / 进程启动时补上（design.md §9.2）。
 *
 * 背景：快照任务每小时整点触发，但只在活动配置的排行榜时间那个小时里真正生成。
 * 进程在那一刻不在线（开发机夜里关机、线上崩溃重启）时那一轮就永久缺失，
 * 而排行榜只读最新一份快照 —— 不补的话它会一直停在几天前的截止日。
 *
 * 钟点一律选远离边界的时刻（09:00 / 00:30），因为 freezeTimeAt 的时间会按真实速度漂移。
 * 活动窗口沿用 bootstrapCampaign 的默认值 2026-10-01 ~ 2026-10-07，排行榜时间 06:00。
 */
describe('排行榜快照漏跑补生成', () => {
  const db = getPrismaClient()

  let campaignId: string
  let adminToken: string

  beforeEach(async () => {
    // 必须先冻结时钟：下面 login 签发的令牌要求 5 分钟内的新鲜认证（requireFreshAuth）
    freezeTimeAt(cst('2026-10-04', '09:00:00'))

    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    campaignId = campaign.id

    const user = await createUser({ studentId: '2026001', name: '参赛者一' })
    const participant = await createParticipant({ campaignId, userId: user.id })
    await createEntry({
      campaignId,
      participantId: participant.id,
      trackId: tracks[0]!.id,
      activityDate: '2026-10-01',
      status: 'approved',
      reviewedAt: cst('2026-10-01', '12:00:00'),
    })

    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
  })

  afterEach(() => {
    unfreezeTime()
  })

  /** 直接跑一次任务本体，不经过锁与 job_runs —— 这里要断言的是补生成行为本身 */
  function runSnapshotJob(): Promise<number> {
    return leaderboardSnapshotJob.execute({ trigger: 'cron', triggeredBy: null, runId: 'test-run' })
  }

  /** 换一个冻结时刻。同一用例里不要连续 freezeTimeAt，先解冻 */
  function setNow(dateTime: string): void {
    unfreezeTime()
    freezeTimeAt(cst(dateTime))
  }

  async function snapshotStates(): Promise<string> {
    const rows = await db.leaderboardSnapshot.findMany({
      where: { campaignId },
      orderBy: { cutoffDate: 'asc' },
      select: { id: true, cutoffDate: true, status: true, isFinal: true, generatedAt: true },
    })
    return JSON.stringify(rows)
  }

  async function cutoffDates(): Promise<string[]> {
    const rows = await db.leaderboardSnapshot.findMany({
      where: { campaignId },
      orderBy: { cutoffDate: 'asc' },
      select: { cutoffDate: true },
    })
    return rows.map((row) => row.cutoffDate)
  }

  it('一份快照都没有时补出应有的最新截止日', async () => {
    // 10-04 09:00 已过当天的 06:00，应有的是昨天那轮：统计至 10-03
    expect(await runSnapshotJob()).toBeGreaterThan(0)
    expect(await cutoffDates()).toEqual(['2026-10-03'])
  })

  it('已经跟上进度时不重算（到点之后每个整点都重算会破坏 §9.2 的口径）', async () => {
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-03' })
    const before = await snapshotStates()

    expect(await runSnapshotJob()).toBe(0)
    expect(await snapshotStates()).toBe(before)
  })

  it('库里已有更新的快照时不倒退、也不重算', async () => {
    // 种子脚本会生成 cutoff = 当天的快照，比任务口径更靠前
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-04' })
    const before = await snapshotStates()

    expect(await runSnapshotJob()).toBe(0)
    expect(await snapshotStates()).toBe(before)
  })

  it('半夜启动不会提前产出还没到点的那一轮', async () => {
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-02' })
    setNow('2026-10-04T00:30:00')

    // 10-04 的 06:00 那轮还没跑，此刻应有的最新仍是 10-02
    expect(await runSnapshotJob()).toBe(0)
    expect(await cutoffDates()).toEqual(['2026-10-02'])
  })

  it('半夜启动会补上昨天欠下的那一轮', async () => {
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-01' })
    setNow('2026-10-04T00:30:00')

    expect(await runSnapshotJob()).toBeGreaterThan(0)
    expect(await cutoffDates()).toEqual(['2026-10-01', '2026-10-02'])
  })

  it('活动还没开始时无事可做，也不报错', async () => {
    setNow('2026-10-01T09:00:00')

    expect(await runSnapshotJob()).toBe(0)
    expect(await cutoffDates()).toEqual([])
  })

  it('活动结束后补跑封顶到结束日，不会算出今天 - 1', async () => {
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-06' })
    setNow('2026-11-20T09:00:00')

    expect(await runSnapshotJob()).toBeGreaterThan(0)
    expect(await cutoffDates()).toEqual(['2026-10-06', '2026-10-07'])
  })

  it('最新一份是 failed 时照样补跑，把它修回 ready', async () => {
    await generateSnapshot({ campaignId, cutoffDate: '2026-10-02' })
    const broken = await generateSnapshot({ campaignId, cutoffDate: '2026-10-03' })
    await db.leaderboardSnapshot.update({
      where: { id: broken.snapshotId },
      data: { status: 'failed', errorSummary: '上一次生成失败' },
    })

    // 落后判据只看可用快照：不该因为有一行 failed 就认为已经跟上
    expect(await runSnapshotJob()).toBeGreaterThan(0)

    const snapshots = await db.leaderboardSnapshot.findMany({
      where: { campaignId },
      orderBy: { cutoffDate: 'asc' },
      select: { id: true, cutoffDate: true, status: true },
    })
    expect(snapshots.map((row) => row.cutoffDate)).toEqual(['2026-10-02', '2026-10-03'])
    expect(snapshots[1]).toMatchObject({ id: broken.snapshotId, status: 'ready' })
  })

  it('到点那一刻照旧生成，且快照已冻结时跳过而不是失败', async () => {
    const frozen = await generateSnapshot({ campaignId, cutoffDate: '2026-10-03' })
    await db.leaderboardSnapshot.update({
      where: { id: frozen.snapshotId },
      data: { isFinal: true, frozenAt: cst('2026-10-04', '07:00:00') },
    })
    const before = await snapshotStates()

    setNow('2026-10-04T06:00:30')

    // SNAPSHOT_FINALIZED 被任务吞掉，不该冒泡成失败
    await expect(runStartupCatchUp()).resolves.toBeUndefined()
    const run = await db.jobRun.findFirstOrThrow({ where: { jobName: 'leaderboard_snapshot' } })
    expect(run.status).toBe('success')

    expect(await snapshotStates()).toBe(before)
  })

  it('管理员手动触发任务走的是同一条补生成路径', async () => {
    const response = await authed(adminToken).post('/api/v1/admin/jobs/leaderboard_snapshot/run')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.processed).toBeGreaterThan(0)
    expect(await cutoffDates()).toEqual(['2026-10-03'])

    const run = await db.jobRun.findFirstOrThrow({ where: { jobName: 'leaderboard_snapshot' } })
    expect(run.trigger).toBe('manual')
    expect(run.status).toBe('success')
  })

  it('进程启动时的补跑不需要等到下一个整点', async () => {
    await runStartupCatchUp()

    expect(await cutoffDates()).toEqual(['2026-10-03'])
    const run = await db.jobRun.findFirstOrThrow({ where: { jobName: 'leaderboard_snapshot' } })
    expect(run.trigger).toBe('cron')
  })
})
