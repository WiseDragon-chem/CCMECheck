import { OVERALL_TRACK_SENTINEL, SCORING_ENTRY_STATUSES } from '../../config/constants.js'
import { formatCstDateTime } from '../../core/time.js'
import { toCsv } from '../../core/text.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { buildScoredRows, loadScoringInputs, POINT_SCALE } from '../../services/scoring.service.js'
import { toScore } from '../leaderboards/service.js'

/**
 * CSV 导出（design.md §3、§12.4）。
 *
 * design.md §16.16 要求导出的人数、记录数与积分和数据库统计一致，
 * 因此积分不在这里另写一套算法，而是直接复用计分引擎 ——
 * 排行榜、快照、导出共用同一份实现，结果不可能对不上。
 *
 * 所有导出都带 UTF-8 BOM，否则 Windows 版 Excel 打开中文会乱码。
 */

export interface ExportFilters {
  track?: string
  status?: string
  from?: string
  to?: string
}

export async function exportCheckinsCsv(
  campaignId: string,
  filters: ExportFilters,
  db: Db = getPrismaClient(),
): Promise<{ filename: string; body: string; rowCount: number }> {
  const entries = await db.checkinEntry.findMany({
    where: {
      campaignId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.track ? { track: { slug: filters.track } } : {}),
      ...(filters.from || filters.to
        ? {
            activityDate: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ activityDate: 'asc' }, { track: { sortOrder: 'asc' } }],
    include: {
      track: { select: { slug: true, name: true } },
      participant: { include: { user: { select: { studentId: true, name: true } } } },
      currentRevision: { select: { revisionNumber: true, note: true, submittedAt: true, _count: { select: { assets: true } } } },
    },
  })

  // 每条记录的得分以其所属赛道的当日分值计，未通过审核一律记 0
  const campaignTracks = await db.campaignTrack.findMany({
    where: { campaignId },
    include: { track: { select: { slug: true } } },
  })
  const dailyPointsBySlug = new Map(campaignTracks.map((item) => [item.track.slug, item.dailyPoints]))

  const headers = [
    '学号',
    '姓名',
    '班级',
    '赛道',
    '活动日',
    '状态',
    '版本号',
    '提交时间(北京时间)',
    '审核时间(北京时间)',
    '证明材料张数',
    '备注',
    '驳回原因',
    '计分(毫点)',
    '是否管理员补录',
  ]

  const rows = entries.map((entry) => {
    const points = SCORING_ENTRY_STATUSES.includes(entry.status as never)
      ? (dailyPointsBySlug.get(entry.track.slug) ?? 0)
      : 0

    return [
      entry.participant.user.studentId,
      entry.participant.user.name,
      entry.participant.className ?? '',
      entry.track.name,
      entry.activityDate,
      entry.status,
      entry.currentRevision?.revisionNumber ?? '',
      formatCstDateTime(entry.currentSubmittedAt),
      entry.reviewedAt ? formatCstDateTime(entry.reviewedAt) : '',
      entry.currentRevision?._count.assets ?? 0,
      entry.currentRevision?.note ?? '',
      entry.rejectionReason ?? '',
      points,
      entry.isManual ? '是' : '否',
    ]
  })

  return {
    filename: `checkins-${new Date().toISOString().slice(0, 10)}.csv`,
    body: toCsv(headers, rows),
    rowCount: rows.length,
  }
}

export async function exportLeaderboardCsv(
  campaignId: string,
  cutoffDate: string,
  db: Db = getPrismaClient(),
): Promise<{ filename: string; body: string; rowCount: number }> {
  const [campaign, inputs, participants, campaignTracks] = await Promise.all([
    db.campaign.findUnique({ where: { id: campaignId }, select: { name: true } }),
    loadScoringInputs(campaignId, cutoffDate, db),
    db.campaignParticipant.findMany({
      where: { campaignId },
      include: { user: { select: { studentId: true, name: true } } },
    }),
    db.campaignTrack.findMany({
      where: { campaignId },
      include: { track: { select: { slug: true, name: true } } },
    }),
  ])

  const participantById = new Map(participants.map((item) => [item.id, item]))
  const trackNameBySlug = new Map(campaignTracks.map((item) => [item.track.slug, item.track.name]))

  const scored = buildScoredRows(inputs).sort((a, b) => {
    if (a.trackSlug !== b.trackSlug) return a.trackSlug < b.trackSlug ? -1 : 1
    return a.rank - b.rank
  })

  const headers = ['榜单', '名次', '学号', '姓名', '班级', '积分', '积分(毫点)', '有效天数', '达到积分时间(北京时间)']

  const rows = scored.map((row) => {
    const participant = participantById.get(row.participantId)
    const isOverall = row.trackSlug === OVERALL_TRACK_SENTINEL
    return [
      isOverall ? '总榜' : (trackNameBySlug.get(row.trackSlug) ?? row.trackSlug),
      row.rank,
      participant?.user.studentId ?? '',
      participant?.user.name ?? '',
      participant?.className ?? '',
      toScore(row.score),
      row.score,
      row.validDays,
      row.reachedAt ? formatCstDateTime(row.reachedAt) : '',
    ]
  })

  return {
    filename: `leaderboard-${campaign?.name ?? 'campaign'}-${cutoffDate}.csv`,
    body: toCsv(headers, rows),
    rowCount: rows.length,
  }
}

export { POINT_SCALE }
