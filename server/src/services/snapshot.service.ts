import type { JobTrigger } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import { addDays, cstToday } from '../core/time.js'
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
 */
export function resolveCronCutoffDate(
  campaign: { startDate: string; endDate: string },
  now: Date = new Date(),
): string | null {
  const candidate = addDays(cstToday(now), -1)
  const bounded = candidate > campaign.endDate ? campaign.endDate : candidate
  return bounded < campaign.startDate ? null : bounded
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
