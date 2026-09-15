import { addDays, cstInstantOf, cstToday } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { requireCurrentCampaign } from '../campaigns/service.js'

/**
 * 管理后台首页统计（design.md §8.1）。
 *
 * 设计文档要求首页展示：
 *   参赛人数、今日提交数、待审核数、今日通过数和驳回数、各赛道提交率、
 *   距离下一次排行榜更新的时间、最近一次定时任务状态、异常任务或上传失败提醒。
 */

export interface DashboardStats {
  campaign: {
    id: string
    name: string
    status: string
    start_date: string
    end_date: string
    leaderboard_visible: boolean
  }
  counts: {
    participants_total: number
    participants_activated: number
    participants_pending_activation: number
    participants_disabled: number
    today_submitted: number
    today_approved: number
    today_rejected: number
    pending_total: number
    pending_today: number
    entries_total: number
    approved_total: number
  }
  tracks: Array<{
    slug: string
    name: string
    enabled: boolean
    submitted_today: number
    approved_today: number
    /** 今日提交率 = 今日提交人数 / 在册参赛人数 */
    submission_rate: number
  }>
  leaderboard: {
    next_update_at: string | null
    seconds_until_next_update: number | null
    latest_snapshot: {
      id: string
      cutoff_date: string
      generated_at: string
      is_final: boolean
      status: string
    } | null
    has_failure: boolean
  }
  last_job_run: {
    job_name: string
    status: string
    started_at: string
    finished_at: string | null
    processed_count: number
    error_summary: string | null
  } | null
  /** 需要管理员关注的异常：失败的定时任务、生成失败的快照 */
  warnings: Array<{ kind: string; message: string; at: string }>
}

/** 下一次排行榜更新的 UTC 瞬时 */
function nextLeaderboardUpdate(leaderboardTime: string, now: Date): Date {
  const today = cstToday(now)
  const todayInstant = cstInstantOf(today, leaderboardTime)
  if (todayInstant.getTime() > now.getTime()) return todayInstant
  return cstInstantOf(addDays(today, 1), leaderboardTime)
}

export async function getDashboardStats(db: Db = getPrismaClient(), now: Date = new Date()): Promise<DashboardStats> {
  const campaign = await requireCurrentCampaign(db)
  const today = cstToday(now)

  // 今日的 CST 日区间，用于按提交时间统计
  const todayStart = cstInstantOf(today, '00:00')
  const todayEnd = cstInstantOf(addDays(today, 1), '00:00')

  const [
    participantsTotal,
    participantsActivated,
    participantsPendingActivation,
    participantsDisabled,
    todaySubmitted,
    todayApproved,
    todayRejected,
    pendingTotal,
    pendingToday,
    entriesTotal,
    approvedTotal,
    todayByTrack,
    latestSnapshot,
    lastJobRun,
    recentFailedJobs,
  ] = await Promise.all([
    db.campaignParticipant.count({ where: { campaignId: campaign.id, status: 'active' } }),
    db.campaignParticipant.count({
      where: { campaignId: campaign.id, status: 'active', user: { status: 'active' } },
    }),
    db.campaignParticipant.count({
      where: { campaignId: campaign.id, user: { status: 'pending_activation' } },
    }),
    db.campaignParticipant.count({ where: { campaignId: campaign.id, status: 'disabled' } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, activityDate: today } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, activityDate: today, status: 'approved' } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, activityDate: today, status: 'rejected' } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, status: 'pending' } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, status: 'pending', activityDate: today } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id } }),
    db.checkinEntry.count({ where: { campaignId: campaign.id, status: 'approved' } }),
    db.checkinEntry.groupBy({
      by: ['trackId', 'status'],
      where: {
        campaignId: campaign.id,
        activityDate: today,
      },
      _count: { _all: true },
    }),
    db.leaderboardSnapshot.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { cutoffDate: 'desc' },
      select: { id: true, cutoffDate: true, generatedAt: true, isFinal: true, status: true, errorSummary: true },
    }),
    db.jobRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.jobRun.findMany({
      where: { status: 'failed', startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
  ])

  // 各赛道今日提交/通过数
  const trackCounts = new Map<string, { submitted: number; approved: number }>()
  for (const row of todayByTrack) {
    const bucket = trackCounts.get(row.trackId) ?? { submitted: 0, approved: 0 }
    bucket.submitted += row._count._all
    if (row.status === 'approved') bucket.approved += row._count._all
    trackCounts.set(row.trackId, bucket)
  }

  const tracks = campaign.campaignTracks.map((campaignTrack) => {
    const counts = trackCounts.get(campaignTrack.trackId) ?? { submitted: 0, approved: 0 }
    return {
      slug: campaignTrack.track.slug,
      name: campaignTrack.track.name,
      enabled: campaignTrack.enabled,
      submitted_today: counts.submitted,
      approved_today: counts.approved,
      submission_rate:
        participantsTotal > 0 ? Math.round((counts.submitted / participantsTotal) * 1000) / 1000 : 0,
    }
  })

  const nextUpdate = nextLeaderboardUpdate(campaign.leaderboardTime, now)

  const warnings: DashboardStats['warnings'] = []
  for (const run of recentFailedJobs) {
    warnings.push({
      kind: 'job_failed',
      message: `定时任务 ${run.jobName} 执行失败：${run.errorSummary ?? '无错误摘要'}`,
      at: run.startedAt.toISOString(),
    })
  }
  if (latestSnapshot?.status === 'failed') {
    warnings.push({
      kind: 'snapshot_failed',
      message: `排行榜快照（统计至 ${latestSnapshot.cutoffDate}）生成失败，当前展示的仍是上一份有效快照`,
      at: latestSnapshot.generatedAt.toISOString(),
    })
  }
  if (pendingTotal > 0 && campaign.status === 'settling') {
    warnings.push({
      kind: 'pending_before_freeze',
      message: `活动已进入结算阶段，仍有 ${pendingTotal} 条记录待审核，清空后才能冻结最终榜单`,
      at: now.toISOString(),
    })
  }

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      start_date: campaign.startDate,
      end_date: campaign.endDate,
      leaderboard_visible: campaign.leaderboardVisible,
    },
    counts: {
      participants_total: participantsTotal,
      participants_activated: participantsActivated,
      participants_pending_activation: participantsPendingActivation,
      participants_disabled: participantsDisabled,
      today_submitted: todaySubmitted,
      today_approved: todayApproved,
      today_rejected: todayRejected,
      pending_total: pendingTotal,
      pending_today: pendingToday,
      entries_total: entriesTotal,
      approved_total: approvedTotal,
    },
    tracks,
    leaderboard: {
      next_update_at: nextUpdate.toISOString(),
      seconds_until_next_update: Math.max(0, Math.floor((nextUpdate.getTime() - now.getTime()) / 1000)),
      latest_snapshot: latestSnapshot
        ? {
            id: latestSnapshot.id,
            cutoff_date: latestSnapshot.cutoffDate,
            generated_at: latestSnapshot.generatedAt.toISOString(),
            is_final: latestSnapshot.isFinal,
            status: latestSnapshot.status,
          }
        : null,
      has_failure: latestSnapshot?.status === 'failed',
    },
    last_job_run: lastJobRun
      ? {
          job_name: lastJobRun.jobName,
          status: lastJobRun.status,
          started_at: lastJobRun.startedAt.toISOString(),
          finished_at: lastJobRun.finishedAt?.toISOString() ?? null,
          processed_count: lastJobRun.processedCount,
          error_summary: lastJobRun.errorSummary,
        }
      : null,
    warnings,
  }
}
