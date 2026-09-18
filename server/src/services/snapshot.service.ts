import type { JobTrigger } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import { addDays, cstInstantOf, cstToday } from '../core/time.js'
import { getPrismaClient, type Db, type PrismaClient } from '../db/client.js'
import { runInTransaction } from '../db/tx.js'
import { buildScoredRows, loadScoringInputs } from './scoring.service.js'

/**
 * 排行榜快照（design.md §9.2、§16.9、§16.15）。
 *
 * 幂等性由 leaderboard_snapshots 上的 (campaign_id, cutoff_date) 唯一约束保证：
 * 任务重复执行只会刷新同一份快照，不会产生第二份结果。
 */

const ROW_INSERT_CHUNK = 500

export interface SnapshotResult {
  snapshotId: string
  cutoffDate: string
  rowCount: number
  generatedAt: Date
  /** 之前就存在同一切算日的快照时为 true */
  regenerated: boolean
}

/**
 * 计算 06:00 任务应当使用的统计截止日。
 *
 * design.md §9.2 只给了文字描述「统计截至前一日结束的所有已审核通过记录」，
 * 这里落成公式：min(今天 - 1 天, 活动结束日)，早于活动开始日则跳过。
 *
 * 它回答的是「到点时该生成哪一天」，**不判断到点没到点**：在排行榜时间之前调用它，
 * 它一样会给出「今天 - 1 天」。要问「此刻本该有的最新快照是哪一份」用
 * resolveExpectedCutoffDate —— 两者在整点 leaderboardTime 的到点时刻恒等，
 * 只在 leaderboardTime 不是整点时不同（那时这里早发，见 leaderboard-snapshot.job）。
 */
export function resolveCronCutoffDate(
  campaign: { startDate: string; endDate: string },
  now: Date = new Date(),
): string | null {
  const candidate = addDays(cstToday(now), -1)
  const bounded = candidate > campaign.endDate ? campaign.endDate : candidate
  return bounded < campaign.startDate ? null : bounded
}

/**
 * 此刻「本该」存在的最新快照统计到哪一天。
 *
 * 与 resolveCronCutoffDate 的差别只在排行榜时间之前的那段时间：那一轮还没到点，
 * 应有的最新一份仍是昨天那轮的产物，也就是「今天 - 2 天」。任务是每小时跑一次的，
 * 进程在到点时刻没运行时那一轮就永久缺失，靠这个函数才能识别「落后了多少」。
 *
 * 早于活动开始日返回 null（还没有任何该产出的快照）。
 */
export function resolveExpectedCutoffDate(
  campaign: { startDate: string; endDate: string; leaderboardTime: string },
  now: Date = new Date(),
): string | null {
  const today = cstToday(now)
  const dueToday = cstInstantOf(today, campaign.leaderboardTime)
  const raw =
    now.getTime() >= dueToday.getTime() ? addDays(today, -1) : addDays(today, -2)

  const bounded = raw > campaign.endDate ? campaign.endDate : raw
  return bounded < campaign.startDate ? null : bounded
}

/**
 * 管理员「重算」时应当使用的统计截止日：本该有的最新日与已有快照里较晚者取较晚。
 *
 * 不能沿用「最近一份快照的 cutoff」—— 那正是重算永远停在过期那一天的原因：
 * 快照落后时点多少次重算，都只是把同一份旧榜单重算一遍。
 *
 * 取「较晚者」是为了两个都不倒退：种子脚本会生成 cutoff = 当天的快照（比 cron 口径更靠前），
 * 活动未开始时 resolveExpectedCutoffDate 又是 null。
 *
 * 这里**刻意不过滤快照状态**：一份 status='failed' 的最新快照也该被重算修好（upsert 会把
 * 它改回 ready），而首页的 snapshot_failed 告警只看该行，绕过它就会让告警一直挂着。
 * 补跑任务的落后判据则相反，刻意只看可用快照 —— 两边目的不同，别改成一模一样。
 */
export async function resolveRebuildCutoffDate(params: {
  campaign: { id: string; startDate: string; endDate: string; leaderboardTime: string }
  now?: Date
  db?: Db
}): Promise<string | null> {
  const { campaign, now = new Date(), db = getPrismaClient() } = params

  const latest = await db.leaderboardSnapshot.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { cutoffDate: 'desc' },
    select: { cutoffDate: true },
  })

  const candidates = [resolveExpectedCutoffDate(campaign, now), latest?.cutoffDate ?? null].filter(
    (date): date is string => date !== null,
  )

  return candidates.length === 0 ? null : candidates.reduce((a, b) => (a > b ? a : b))
}

export async function generateSnapshot(params: {
  campaignId: string
  cutoffDate: string
  trigger?: JobTrigger
  triggeredBy?: string | null
  /**
   * 必须是完整的 PrismaClient 而不是事务客户端 —— 这里要自己开事务。
   * 传入事务客户端只用于测试时注入。
   */
  db?: PrismaClient
}): Promise<SnapshotResult> {
  const { campaignId, cutoffDate } = params
  const prisma = params.db ?? getPrismaClient()

  const existing = await prisma.leaderboardSnapshot.findUnique({
    where: { campaignId_cutoffDate: { campaignId, cutoffDate } },
    select: { id: true, isFinal: true },
  })

  // 冻结后快照行永不被重写（§16.15）
  if (existing?.isFinal) {
    throw new AppError('SNAPSHOT_FINALIZED', '该榜单已冻结，如需重算请先解冻')
  }

  const inputs = await loadScoringInputs(campaignId, cutoffDate, prisma)
  const rows = buildScoredRows(inputs)
  const generatedAt = new Date()

  const snapshotId = await runInTransaction(prisma, async (tx) => {
    // 事务内二次确认，避免与并发的冻结操作竞争
    const current = await tx.leaderboardSnapshot.findUnique({
      where: { campaignId_cutoffDate: { campaignId, cutoffDate } },
      select: { id: true, isFinal: true },
    })
    if (current?.isFinal) {
      throw new AppError('SNAPSHOT_FINALIZED', '该榜单已冻结，如需重算请先解冻')
    }

    const snapshot = await tx.leaderboardSnapshot.upsert({
      where: { campaignId_cutoffDate: { campaignId, cutoffDate } },
      create: {
        campaignId,
        cutoffDate,
        status: 'ready',
        generatedAt,
        trigger: params.trigger ?? 'cron',
        triggeredBy: params.triggeredBy ?? null,
        rowCount: rows.length,
      },
      update: {
        status: 'ready',
        generatedAt,
        trigger: params.trigger ?? 'cron',
        triggeredBy: params.triggeredBy ?? null,
        rowCount: rows.length,
        errorSummary: null,
      },
    })

    // 先删后插：同一份快照重复生成时得到确定性的结果，而不是累加
    await tx.leaderboardRow.deleteMany({ where: { snapshotId: snapshot.id } })

    for (let index = 0; index < rows.length; index += ROW_INSERT_CHUNK) {
      const chunk = rows.slice(index, index + ROW_INSERT_CHUNK)
      await tx.leaderboardRow.createMany({
        data: chunk.map((row) => ({
          snapshotId: snapshot.id,
          participantId: row.participantId,
          trackId: row.trackSlug,
          rank: row.rank,
          score: row.score,
          validDays: row.validDays,
          reachedAt: row.reachedAt,
        })),
      })
    }

    return snapshot.id
  })

  return {
    snapshotId,
    cutoffDate,
    rowCount: rows.length,
    generatedAt,
    regenerated: existing !== null,
  }
}

/** 生成失败时把错误摘要写回快照行，供管理后台首页告警（design.md §14） */
export async function markSnapshotFailed(campaignId: string, cutoffDate: string, message: string): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.leaderboardSnapshot
    .update({
      where: { campaignId_cutoffDate: { campaignId, cutoffDate } },
      data: { status: 'failed', errorSummary: message.slice(0, 500) },
    })
    // 快照行可能压根没建起来（例如首次执行就失败），此时忽略
    .catch(() => undefined)
}

export async function freezeSnapshot(params: {
  campaignId: string
  cutoffDate?: string
  frozenBy: string
}): Promise<SnapshotResult> {
  const prisma = getPrismaClient()

  const snapshot = params.cutoffDate
    ? await prisma.leaderboardSnapshot.findUnique({
        where: { campaignId_cutoffDate: { campaignId: params.campaignId, cutoffDate: params.cutoffDate } },
      })
    : await prisma.leaderboardSnapshot.findFirst({
        where: { campaignId: params.campaignId },
        orderBy: { cutoffDate: 'desc' },
      })

  if (!snapshot) throw new AppError('NOT_FOUND', '尚无可冻结的排行榜快照')
  if (snapshot.isFinal) return { snapshotId: snapshot.id, cutoffDate: snapshot.cutoffDate, rowCount: snapshot.rowCount, generatedAt: snapshot.generatedAt, regenerated: false }

  // §9.2：活动结束时管理员需要先清空待审核队列，再生成并冻结最终榜单。
  // 这里把该要求变成硬性前置条件，否则冻结出的榜单会漏掉仍在队列里的记录。
  const pendingCount = await prisma.checkinEntry.count({
    where: { campaignId: params.campaignId, status: 'pending' },
  })
  if (pendingCount > 0) {
    throw new AppError('PENDING_REVIEWS_REMAIN', `仍有 ${pendingCount} 条记录待审核，请先完成审核再冻结最终榜单`, {
      details: { pending_count: pendingCount },
    })
  }

  const frozenAt = new Date()
  await prisma.leaderboardSnapshot.update({
    where: { id: snapshot.id },
    data: { isFinal: true, frozenAt, frozenBy: params.frozenBy, status: 'ready' },
  })

  return {
    snapshotId: snapshot.id,
    cutoffDate: snapshot.cutoffDate,
    rowCount: snapshot.rowCount,
    generatedAt: snapshot.generatedAt,
    regenerated: false,
  }
}

export async function unfreezeSnapshot(params: { campaignId: string; cutoffDate: string }): Promise<void> {
  const prisma = getPrismaClient()
  const snapshot = await prisma.leaderboardSnapshot.findUnique({
    where: { campaignId_cutoffDate: { campaignId: params.campaignId, cutoffDate: params.cutoffDate } },
    select: { id: true, isFinal: true },
  })
  if (!snapshot) throw new AppError('NOT_FOUND', '快照不存在')
  if (!snapshot.isFinal) return

  await prisma.leaderboardSnapshot.update({
    where: { id: snapshot.id },
    data: { isFinal: false, frozenAt: null, frozenBy: null },
  })
}

/** 当前活动最新的可用快照 */
export async function findLatestSnapshot(campaignId: string, db: Db = getPrismaClient()) {
  return db.leaderboardSnapshot.findFirst({
    where: { campaignId, status: { in: ['ready', 'generating'] } },
    orderBy: { cutoffDate: 'desc' },
  })
}
