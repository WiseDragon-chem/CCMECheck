import { OVERALL_TRACK_SENTINEL, SCORING_ENTRY_STATUSES } from '../config/constants.js'
import { getPrismaClient, type Db } from '../db/client.js'

/**
 * 计分引擎（design.md §9.1、§9.3）。
 *
 * 这里全部是纯函数，排行榜、每日快照、CSV 导出共用同一份实现 ——
 * §16.16 要求导出结果与数据库统计一致，前提就是只有一份算法。
 *
 * 积分一律以「整数毫点」表示（1000 = 1 分），权重是「整数千分比」（1000 = 1.0）。
 * 用整数是刻意的：如果用小数权重做浮点累加，尾差会让「同分并列」的判定
 * 在不同次计算之间抖动，名次随之漂移。
 */

export const POINT_SCALE = 1000

export interface TrackScoringConfig {
  trackId: string
  slug: string
  /** 每次审核通过获得的分值（毫点） */
  dailyPoints: number
  /** 单个活动日的上限（毫点）；null 表示不限 */
  dailyCap: number | null
  /** 整个活动的上限（毫点）；null 表示不限 */
  campaignCap: number | null
  /** 总榜权重，千分比 */
  overallWeight: number
  enabled: boolean
}

/** 一条计分输入：某个参与者某天在某赛道的一条审核通过记录 */
export interface ScoringEntry {
  trackSlug: string
  activityDate: string
  /** 审核通过时间，决定「达到当前积分的时间」 */
  reviewedAt: Date | null
}

export interface ScoringAdjustment {
  trackSlug: string
  pointsDelta: number
  createdAt: Date
}

export interface TrackScore {
  slug: string
  /** 已经过每日上限与活动上限约束的得分（毫点），不含人工调整 */
  earned: number
  /** 计入人工调整后的最终得分（毫点） */
  score: number
  /** 该赛道有效打卡天数 */
  validDays: number
  /** 累计首次达到最终得分的时刻（§9.3 同分判定第 ③ 项） */
  reachedAt: Date | null
}

export interface ParticipantScore {
  participantId: string
  tracks: Map<string, TrackScore>
  /** 总榜得分（毫点） */
  totalScore: number
  /** 总榜有效天数：至少有一条通过记录的不同活动日数 */
  totalValidDays: number
  reachedAt: Date | null
}

// ---------------------------------------------------------------------------
// 单赛道计分
// ---------------------------------------------------------------------------

/** 把某个赛道的通过记录按活动日分组，并施加每日上限 */
function dailyTotals(
  config: TrackScoringConfig,
  entries: readonly ScoringEntry[],
): Array<{ activityDate: string; points: number; reviewedAt: Date | null }> {
  const byDate = new Map<string, { points: number; reviewedAt: Date | null }>()

  for (const entry of entries) {
    const existing = byDate.get(entry.activityDate)
    // 槽位唯一约束保证同一天同一赛道只有一条通过记录，
    // 这里仍然按「先到先得 + 每日上限」处理，避免未来放开约束时静默算错
    if (!existing) {
      byDate.set(entry.activityDate, { points: config.dailyPoints, reviewedAt: entry.reviewedAt })
      continue
    }
    if (existing.reviewedAt && entry.reviewedAt && entry.reviewedAt < existing.reviewedAt) {
      existing.reviewedAt = entry.reviewedAt
    }
  }

  const days = [...byDate.entries()]
    .map(([activityDate, value]) => ({
      activityDate,
      points: config.dailyCap === null ? value.points : Math.min(value.points, config.dailyCap),
      reviewedAt: value.reviewedAt,
    }))
    .sort((a, b) => (a.activityDate < b.activityDate ? -1 : a.activityDate > b.activityDate ? 1 : 0))

  return days
}

export function computeTrackScore(params: {
  config: TrackScoringConfig
  entries: readonly ScoringEntry[]
  adjustments: readonly ScoringAdjustment[]
}): TrackScore {
  const { config, entries, adjustments } = params

  const days = dailyTotals(config, entries)

  // 活动上限约束的是「打卡挣来的分」，不约束人工调整：
  // 否则管理员为特殊记录加分会被 campaign_cap 静默吃掉，调整就失去意义
  const rawEarned = days.reduce((sum, day) => sum + day.points, 0)
  const earned = config.campaignCap === null ? rawEarned : Math.min(rawEarned, config.campaignCap)

  const adjustmentTotal = adjustments.reduce((sum, item) => sum + item.pointsDelta, 0)

  // 「达到当前积分的时间」：按审核时间升序累加，取累计值首次达到最终得分的时刻
  let reachedAt: Date | null = null
  if (earned > 0) {
    const byReviewedAt = days
      .filter((day) => day.reviewedAt !== null)
      .sort((a, b) => a.reviewedAt!.getTime() - b.reviewedAt!.getTime())

    let running = 0
    for (const day of byReviewedAt) {
      running += day.points
      if (running >= earned) {
        reachedAt = day.reviewedAt
        break
      }
    }
  }

  // 人工调整发生在计分之后，若它才是最后一步，则达到时间取更晚的那个
  if (adjustmentTotal !== 0 && adjustments.length > 0) {
    const latestAdjustment = adjustments.reduce(
      (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
      adjustments[0]!.createdAt,
    )
    if (!reachedAt || latestAdjustment > reachedAt) reachedAt = latestAdjustment
  }

  return {
    slug: config.slug,
    earned,
    score: earned + adjustmentTotal,
    validDays: days.length,
    reachedAt,
  }
}

// ---------------------------------------------------------------------------
// 参与者总分与排名
// ---------------------------------------------------------------------------

export interface ParticipantScoringInput {
  participantId: string
  /** 可变数组：调用方（loadScoringInputs）按参与者分桶累积 */
  entries: ScoringEntry[]
  adjustments: ScoringAdjustment[]
}

export function computeParticipantScore(params: {
  participantId: string
  configs: readonly TrackScoringConfig[]
  input: ParticipantScoringInput
}): ParticipantScore {
  const { participantId, configs, input } = params

  const bySlug = new Map<string, ScoringEntry[]>()
  for (const entry of input.entries) {
    const list = bySlug.get(entry.trackSlug)
    if (list) list.push(entry)
    else bySlug.set(entry.trackSlug, [entry])
  }

  const adjustmentsBySlug = new Map<string, ScoringAdjustment[]>()
  for (const adjustment of input.adjustments) {
    const list = adjustmentsBySlug.get(adjustment.trackSlug)
    if (list) list.push(adjustment)
    else adjustmentsBySlug.set(adjustment.trackSlug, [adjustment])
  }

  const tracks = new Map<string, TrackScore>()
  // 先累加再除，避免每个赛道各舍入一次带来的累计误差
  let weightedTotal = 0
  let reachedAt: Date | null = null
  const allDates = new Set<string>()

  for (const config of configs) {
    const trackScore = computeTrackScore({
      config,
      entries: bySlug.get(config.slug) ?? [],
      adjustments: adjustmentsBySlug.get(config.slug) ?? [],
    })
    tracks.set(config.slug, trackScore)

    weightedTotal += trackScore.score * config.overallWeight

    if (trackScore.reachedAt && (!reachedAt || trackScore.reachedAt > reachedAt)) {
      reachedAt = trackScore.reachedAt
    }
    for (const entry of bySlug.get(config.slug) ?? []) allDates.add(entry.activityDate)
  }

  // 总榜行的人工调整（track_id 为哨兵值）不计入任何赛道，直接加在总分上
  const overallAdjustments = adjustmentsBySlug.get(OVERALL_TRACK_SENTINEL) ?? []
  const overallAdjustmentTotal = overallAdjustments.reduce((sum, item) => sum + item.pointsDelta, 0)
  if (overallAdjustments.length > 0) {
    const latest = overallAdjustments.reduce(
      (acc, item) => (item.createdAt > acc ? item.createdAt : acc),
      overallAdjustments[0]!.createdAt,
    )
    if (!reachedAt || latest > reachedAt) reachedAt = latest
  }

  return {
    participantId,
    tracks,
    totalScore: Math.round(weightedTotal / POINT_SCALE) + overallAdjustmentTotal,
    totalValidDays: allDates.size,
    reachedAt,
  }
}

// ---------------------------------------------------------------------------
// 排名
// ---------------------------------------------------------------------------

export interface RankableRow {
  participantId: string
  score: number
  validDays: number
  reachedAt: Date | null
}

/**
 * §9.3 的排序与并列规则。
 *
 * 展示顺序依次比较：积分降序 → 有效天数降序 → 达到积分时间升序 → 内部稳定标识。
 * 前三项全部相同才算真正的并列；第四项只用来让展示顺序稳定可复现。
 *
 * 活动配置里的 `tieBreakRule` 必须与这里实现的规则一致。目前只支持一种取值
 * （TIE_BREAK_RULES 里也只有它），因此真正的问题是：将来有人往
 * TIE_BREAK_RULES 里加了第二种，而忘了改这个函数 —— 那时配置会被静默忽略。
 * buildScoredRows 会校验这一点，直接报错而不是默默按默认排序。
 */
export function compareRanking(a: RankableRow, b: RankableRow): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.validDays !== b.validDays) return b.validDays - a.validDays

  const aTime = a.reachedAt?.getTime() ?? Number.POSITIVE_INFINITY
  const bTime = b.reachedAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (aTime !== bTime) return aTime - bTime

  return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0
}

function isTied(a: RankableRow, b: RankableRow): boolean {
  return (
    a.score === b.score &&
    a.validDays === b.validDays &&
    (a.reachedAt?.getTime() ?? null) === (b.reachedAt?.getTime() ?? null)
  )
}

/**
 * 标准竞赛排名：同分同名次，后续跳号（1,1,3）。
 * 输入必须是已按 compareRanking 排好序的数组。
 */
export function assignRanks(rows: readonly RankableRow[]): number[] {
  const ranks: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    if (previous && isTied(previous, rows[index]!)) {
      ranks.push(ranks[index - 1]!)
    } else {
      ranks.push(index + 1)
    }
  }
  return ranks
}

// ---------------------------------------------------------------------------
// 从数据库装载计分输入
// ---------------------------------------------------------------------------

export interface ScoringInputs {
  configs: TrackScoringConfig[]
  byParticipant: Map<string, ParticipantScoringInput>
  /** 活动配置的排序规则；buildScoredRows 会校验它是否被支持 */
  tieBreakRule: string
}

/** compareRanking 实际实现的规则。加新规则时这里和那个函数要一起改。 */
export const IMPLEMENTED_TIE_BREAK_RULE = 'score_desc_valid_days_desc_reached_at_asc'

/**
 * 装载某活动在 cutoffDate（含）之前的全部计分输入。
 *
 * 统计口径（design.md §9.2）：只计 activity_date <= cutoff_date 且
 * **当前已审核通过**的记录。生成快照时仍待审核的记录本次不计分，
 * 之后通过会进入下一次快照。
 */
export async function loadScoringInputs(
  campaignId: string,
  cutoffDate: string,
  db: Db = getPrismaClient(),
): Promise<ScoringInputs> {
  const [campaign, campaignTracks, participants, entries, adjustments] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { tieBreakRule: true } }),
    db.campaignTrack.findMany({
      where: { campaignId },
      include: { track: { select: { slug: true } } },
    }),
    db.campaignParticipant.findMany({
      where: { campaignId, status: { not: 'anonymized' } },
      select: { id: true },
    }),
    db.checkinEntry.findMany({
      where: {
        campaignId,
        activityDate: { lte: cutoffDate },
        status: { in: [...SCORING_ENTRY_STATUSES] },
      },
      select: {
        participantId: true,
        activityDate: true,
        reviewedAt: true,
        track: { select: { slug: true } },
      },
    }),
    db.scoreAdjustment.findMany({
      where: { campaignId },
      select: { participantId: true, trackId: true, pointsDelta: true, createdAt: true },
    }),
  ])

  const configs: TrackScoringConfig[] = campaignTracks.map((item) => ({
    trackId: item.trackId,
    slug: item.track.slug,
    dailyPoints: item.dailyPoints,
    dailyCap: item.dailyCap,
    campaignCap: item.campaignCap,
    overallWeight: item.overallWeight,
    enabled: item.enabled,
  }))

  const byParticipant = new Map<string, ParticipantScoringInput>()
  for (const participant of participants) {
    byParticipant.set(participant.id, {
      participantId: participant.id,
      entries: [],
      adjustments: [],
    })
  }

  const ensure = (participantId: string): ParticipantScoringInput => {
    let bucket = byParticipant.get(participantId)
    if (!bucket) {
      bucket = { participantId, entries: [], adjustments: [] }
      byParticipant.set(participantId, bucket)
    }
    return bucket
  }

  for (const entry of entries) {
    ensure(entry.participantId).entries.push({
      trackSlug: entry.track.slug,
      activityDate: entry.activityDate,
      reviewedAt: entry.reviewedAt,
    })
  }

  for (const adjustment of adjustments) {
    // track_id 可能是赛道 slug，也可能是总榜哨兵值
    ensure(adjustment.participantId).adjustments.push({
      trackSlug: adjustment.trackId,
      pointsDelta: adjustment.pointsDelta,
      createdAt: adjustment.createdAt,
    })
  }

  return { configs, byParticipant, tieBreakRule: campaign.tieBreakRule }
}

export interface ScoredRow extends RankableRow {
  trackSlug: string
  rank: number
}

/**
 * 生成某个快照下的全部排行榜行（含总榜哨兵行）。
 * 调用方负责把结果写入 leaderboard_rows。
 */
export function buildScoredRows(inputs: ScoringInputs): ScoredRow[] {
  // 活动配置里的排序规则必须与 compareRanking 实现的一致。
  // 校验而不是静默忽略：将来往 TIE_BREAK_RULES 加了第二种取值却忘了改
  // compareRanking 时，这里会直接报错 —— 否则新规则会被无声地当成默认规则，
  // 而排行榜看起来「正常」，没人会发现。
  if (inputs.tieBreakRule !== IMPLEMENTED_TIE_BREAK_RULE) {
    throw new Error(
      `不支持的排名同分规则：${inputs.tieBreakRule}（当前只实现了 ${IMPLEMENTED_TIE_BREAK_RULE}）`,
    )
  }

  const activeConfigs = inputs.configs.filter((config) => config.enabled)
  const results: ScoredRow[] = []

  // ---- 分赛道榜 ----
  for (const config of activeConfigs) {
    const rows: RankableRow[] = []
    for (const participant of inputs.byParticipant.values()) {
      const scored = computeParticipantScore({
        participantId: participant.participantId,
        configs: [config],
        input: participant,
      })
      const track = scored.tracks.get(config.slug)
      rows.push({
        participantId: participant.participantId,
        score: track?.score ?? 0,
        validDays: track?.validDays ?? 0,
        reachedAt: track?.reachedAt ?? null,
      })
    }

    rows.sort(compareRanking)
    const ranks = assignRanks(rows)
    rows.forEach((row, index) => {
      results.push({ ...row, trackSlug: config.slug, rank: ranks[index]! })
    })
  }

  // ---- 总榜 ----
  const overallRows: RankableRow[] = []
  for (const participant of inputs.byParticipant.values()) {
    const scored = computeParticipantScore({
      participantId: participant.participantId,
      configs: activeConfigs,
      input: participant,
    })
    overallRows.push({
      participantId: participant.participantId,
      score: scored.totalScore,
      validDays: scored.totalValidDays,
      reachedAt: scored.reachedAt,
    })
  }

  overallRows.sort(compareRanking)
  const overallRanks = assignRanks(overallRows)
  overallRows.forEach((row, index) => {
    results.push({ ...row, trackSlug: OVERALL_TRACK_SENTINEL, rank: overallRanks[index]! })
  })

  return results
}
