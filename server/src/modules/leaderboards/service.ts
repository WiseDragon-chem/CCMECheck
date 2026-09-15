import { OVERALL_TRACK_SENTINEL } from '../../config/constants.js'
import { AppError } from '../../core/errors.js'
import type { AuthPrincipal } from '../../core/principal.js'
import { displayName } from '../../core/text.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { POINT_SCALE } from '../../services/scoring.service.js'
import { findLatestSnapshot } from '../../services/snapshot.service.js'
import { requireCurrentCampaign } from '../campaigns/service.js'

export const OVERALL_LABEL = '总榜'

export interface LeaderboardRowView {
  rank: number
  participant_id: string
  name: string
  class_name: string | null
  valid_days: number
  /** 展示用分值，保留三位小数 */
  score: number
  /** 精确值（整数毫点），供需要精确比较的客户端使用 */
  score_milli: number
  reached_at: string | null
  is_me: boolean
}

export interface LeaderboardView {
  snapshot: {
    id: string
    cutoff_date: string
    generated_at: string
    is_final: boolean
    status: string
  } | null
  track: { slug: string; name: string }
  /** design.md §7.6：页面需展示已统计到的活动日期 */
  counted_through: string | null
  rows: LeaderboardRowView[]
  total: number
  /** 当前用户排名附近的窗口，未参赛或未上榜时为 null */
  me: { row: LeaderboardRowView; window: LeaderboardRowView[] } | null
}

/** 毫点转展示分值（最多三位小数），导出一并复用，保证与页面显示一致 */
export function toScore(milli: number): number {
  return Math.round((milli / POINT_SCALE) * 1000) / 1000
}

/** 排行榜不展示学号、证明材料和驳回记录（design.md §7.6） */
function toRowView(
  row: { rank: number; participantId: string; score: number; validDays: number; reachedAt: Date | null },
  participant: { user: { name: string }; className: string | null },
  nameMode: string,
  myParticipantId: string | null,
): LeaderboardRowView {
  return {
    rank: row.rank,
    participant_id: row.participantId,
    name: displayName(participant.user.name, nameMode),
    class_name: participant.className,
    valid_days: row.validDays,
    score: toScore(row.score),
    score_milli: row.score,
    reached_at: row.reachedAt?.toISOString() ?? null,
    is_me: myParticipantId !== null && row.participantId === myParticipantId,
  }
}

async function resolveTrack(
  campaignId: string,
  trackSlug: string | undefined,
  db: Db,
): Promise<{ slug: string; name: string }> {
  if (!trackSlug || trackSlug === OVERALL_TRACK_SENTINEL) {
    return { slug: OVERALL_TRACK_SENTINEL, name: OVERALL_LABEL }
  }
  const campaignTrack = await db.campaignTrack.findFirst({
    where: { campaignId, track: { slug: trackSlug } },
    include: { track: { select: { slug: true, name: true } } },
  })
  if (!campaignTrack) throw new AppError('NOT_FOUND', '该赛道不在此活动中')
  return { slug: campaignTrack.track.slug, name: campaignTrack.track.name }
}

/** 排行榜可见性：活动可配置是否对参赛者公开（design.md §6.1） */
function assertVisible(principal: AuthPrincipal, leaderboardVisible: boolean): void {
  if (leaderboardVisible) return
  if (principal.role === 'reviewer' || principal.role === 'super_admin') return
  throw new AppError('FORBIDDEN', '本次活动暂未公开排行榜')
}

export async function getLatestLeaderboard(
  principal: AuthPrincipal,
  query: { track?: string; limit?: number; offset?: number },
): Promise<LeaderboardView> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  assertVisible(principal, campaign.leaderboardVisible)

  const track = await resolveTrack(campaign.id, query.track, prisma)

  const snapshot = await findLatestSnapshot(campaign.id, prisma)
  if (!snapshot) {
    return {
      snapshot: null,
      track,
      counted_through: null,
      rows: [],
      total: 0,
      me: null,
    }
  }

  const me = await prisma.campaignParticipant.findUnique({
    where: { campaignId_userId: { campaignId: campaign.id, userId: principal.userId } },
    select: { id: true },
  })

  const where = { snapshotId: snapshot.id, trackId: track.slug }
  const [total, rows] = await Promise.all([
    prisma.leaderboardRow.count({ where }),
    prisma.leaderboardRow.findMany({
      where,
      orderBy: { rank: 'asc' },
      skip: query.offset ?? 0,
      take: query.limit ?? 100,
      include: { participant: { include: { user: { select: { name: true } } } } },
    }),
  ])

  const views = rows.map((row) =>
    toRowView(row, row.participant, campaign.nameDisplayMode, me?.id ?? null),
  )

  // 分页时「我」可能不在当前页，单独取一次，前端要固定显示自己那一行
  let meView: LeaderboardView['me'] = null
  if (me) {
    const myRow = await prisma.leaderboardRow.findUnique({
      where: { snapshotId_trackId_participantId: { snapshotId: snapshot.id, trackId: track.slug, participantId: me.id } },
      include: { participant: { include: { user: { select: { name: true } } } } },
    })
    if (myRow) {
      meView = {
        row: toRowView(myRow, myRow.participant, campaign.nameDisplayMode, me.id),
        window: [],
      }
    }
  }

  return {
    snapshot: {
      id: snapshot.id,
      cutoff_date: snapshot.cutoffDate,
      generated_at: snapshot.generatedAt.toISOString(),
      is_final: snapshot.isFinal,
      status: snapshot.status,
    },
    track,
    counted_through: snapshot.cutoffDate,
    rows: views,
    total,
    me: meView,
  }
}

export async function getMyRank(
  principal: AuthPrincipal,
  query: { track?: string; neighbors: number },
): Promise<LeaderboardView> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  assertVisible(principal, campaign.leaderboardVisible)

  const track = await resolveTrack(campaign.id, query.track, prisma)

  const snapshot = await findLatestSnapshot(campaign.id, prisma)
  if (!snapshot) {
    return { snapshot: null, track, counted_through: null, rows: [], total: 0, me: null }
  }

  const participant = await prisma.campaignParticipant.findUnique({
    where: { campaignId_userId: { campaignId: campaign.id, userId: principal.userId } },
    select: { id: true },
  })
  if (!participant) {
    return {
      snapshot: {
        id: snapshot.id,
        cutoff_date: snapshot.cutoffDate,
        generated_at: snapshot.generatedAt.toISOString(),
        is_final: snapshot.isFinal,
        status: snapshot.status,
      },
      track,
      counted_through: snapshot.cutoffDate,
      rows: [],
      total: 0,
      me: null,
    }
  }

  const myRow = await prisma.leaderboardRow.findUnique({
    where: {
      snapshotId_trackId_participantId: {
        snapshotId: snapshot.id,
        trackId: track.slug,
        participantId: participant.id,
      },
    },
    include: { participant: { include: { user: { select: { name: true } } } } },
  })

  const total = await prisma.leaderboardRow.count({ where: { snapshotId: snapshot.id, trackId: track.slug } })

  const base = {
    snapshot: {
      id: snapshot.id,
      cutoff_date: snapshot.cutoffDate,
      generated_at: snapshot.generatedAt.toISOString(),
      is_final: snapshot.isFinal,
      status: snapshot.status,
    },
    track,
    counted_through: snapshot.cutoffDate,
    total,
  }

  if (!myRow) {
    return { ...base, rows: [], me: null }
  }

  // 取排名前后各 neighbors 名
  const window = await prisma.leaderboardRow.findMany({
    where: {
      snapshotId: snapshot.id,
      trackId: track.slug,
      rank: { gte: Math.max(1, myRow.rank - query.neighbors), lte: myRow.rank + query.neighbors },
    },
    orderBy: { rank: 'asc' },
    include: { participant: { include: { user: { select: { name: true } } } } },
  })

  const windowViews = window.map((row) =>
    toRowView(row, row.participant, campaign.nameDisplayMode, participant.id),
  )

  return {
    ...base,
    rows: windowViews,
    me: { row: toRowView(myRow, myRow.participant, campaign.nameDisplayMode, participant.id), window: windowViews },
  }
}
