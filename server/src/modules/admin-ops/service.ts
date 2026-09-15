import {
  ENTRY_STATUS_TRANSITIONS,
  MAX_REOPEN_MINUTES,
  OVERALL_TRACK_SENTINEL,
  SUBMITTABLE_CAMPAIGN_STATUSES,
  type EntryStatus,
  type ReviewActionType,
  type UserRole,
} from '../../config/constants.js'
import { AppError, notFound } from '../../core/errors.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { auditContextFrom, recordAudit } from '../../services/audit.service.js'
import { requireCurrentCampaign } from '../campaigns/service.js'

/**
 * §8.5 异常处理。
 *
 * 这里全部是超级管理员的高风险操作，共同点有三条：
 *   1. 必须填写原因（schema 层已强制），原因同时进 review_actions 和审计日志（§16.14）；
 *   2. 必须带 version 做乐观并发控制，避免与参赛者重新提交或另一位管理员的操作互相覆盖；
 *   3. 一律在事务内与审计一起提交 —— 「业务改了但审计丢了」在这类操作里不可接受。
 */

export type AuditContext = ReturnType<typeof auditContextFrom>

/** 所有写操作共用的执行者信息 */
export interface AdminActor {
  userId: string
  role: UserRole
}

/**
 * review_actions.action 的取值。
 * 用 satisfies 挂到 constants.REVIEW_ACTIONS 上：写错动作名会在编译期报错，
 * 而不是等到运行时往库里写一个非法值。
 */
const REVIEW_ACTION = {
  reopen: 'reopen',
  revoke: 'revoke',
  void: 'void',
  manualCreate: 'manual_create',
} as const satisfies Record<string, ReviewActionType>

// ---------------------------------------------------------------------------
// 公共校验
// ---------------------------------------------------------------------------

interface EntryRow {
  id: string
  status: string
  version: number
  currentRevisionId: string | null
  activityDate: string
  reviewedAt: Date | null
  reviewedBy: string | null
  rejectionCode: string | null
  rejectionReason: string | null
  reopenExpiresAt: Date | null
  isManual: boolean
  campaignStatus: string
}

/** 读一条记录（连活动状态一起带上，省掉一次查询）；不存在时给统一的 404 文案 */
async function requireEntry(tx: Db, entryId: string): Promise<EntryRow> {
  const entry = await tx.checkinEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      status: true,
      version: true,
      currentRevisionId: true,
      activityDate: true,
      reviewedAt: true,
      reviewedBy: true,
      rejectionCode: true,
      rejectionReason: true,
      reopenExpiresAt: true,
      isManual: true,
      campaign: { select: { status: true } },
    },
  })
  if (!entry) throw notFound('打卡记录不存在')
  return { ...entry, campaignStatus: entry.campaign.status }
}

/** §8.2/§16.8：版本号对不上，说明这份记录已经被别人改过 */
function reviewConflict(currentVersion: number): AppError {
  return new AppError('REVIEW_CONFLICT', '该记录已被其他人修改，请刷新后重试', {
    details: { current_version: currentVersion },
  })
}

/** Prisma 的 P2025：where 没有匹配到记录 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  )
}

/**
 * 校验版本号并按状态机判断迁移是否允许。
 *
 * 状态机以 constants 的 ENTRY_STATUS_TRANSITIONS 为唯一依据，
 * 不在这里另行硬编码迁移规则，否则迟早会和 §6.4 漂移。
 */
function assertTransition(entry: EntryRow, expectedVersion: number, target: EntryStatus, hint: string): void {
  if (entry.version !== expectedVersion) throw reviewConflict(entry.version)
  const allowed = ENTRY_STATUS_TRANSITIONS[entry.status as EntryStatus] ?? []
  if (!allowed.includes(target)) {
    throw new AppError('STATE_TRANSITION_INVALID', `当前状态（${entry.status}）不能${hint}`)
  }
}

/** 写操作返回的记录快照，供前端就地刷新那一行 */
export interface EntryStatePayload {
  entry_id: string
  status: EntryStatus
  version: number
  activity_date: string
  reviewed_at: string | null
  reviewed_by: string | null
  rejection_code: string | null
  rejection_reason: string | null
  reopen_expires_at: string | null
  is_manual: boolean
}

interface EntryStateLike {
  id: string
  status: string
  version: number
  activityDate: string
  reviewedAt: Date | null
  reviewedBy: string | null
  rejectionCode: string | null
  rejectionReason: string | null
  reopenExpiresAt: Date | null
  isManual: boolean
}

function toEntryState(entry: EntryStateLike): EntryStatePayload {
  return {
    entry_id: entry.id,
    status: entry.status as EntryStatus,
    version: entry.version,
    activity_date: entry.activityDate,
    reviewed_at: entry.reviewedAt?.toISOString() ?? null,
    reviewed_by: entry.reviewedBy,
    rejection_code: entry.rejectionCode,
    rejection_reason: entry.rejectionReason,
    reopen_expires_at: entry.reopenExpiresAt?.toISOString() ?? null,
    is_manual: entry.isManual,
  }
}

// ---------------------------------------------------------------------------
// §8.5 临时重新开放某个打卡槽位
// ---------------------------------------------------------------------------

export interface ReopenEntryInput {
  entryId: string
  version: number
  reason: string
  reopenMinutes: number
  actor: AdminActor
  audit: AuditContext
}

export interface ReopenEntryResult extends EntryStatePayload {
  /** 重开只放宽截止；活动本身不可提交时参赛者仍然交不上来，这里提前告诉管理员 */
  campaign_submittable: boolean
  warning: string | null
}

export async function reopenEntry(input: ReopenEntryInput): Promise<ReopenEntryResult> {
  const prisma = getPrismaClient()

  // schema 已经限制了区间，这里再挡一次：重开时长直接决定这条记录能不能越过每日截止，
  // 属于「宁可多校验一次」的规则，不能只依赖调用方传对参数
  if (input.reopenMinutes < 1 || input.reopenMinutes > MAX_REOPEN_MINUTES) {
    throw new AppError(
      'VALIDATION_FAILED',
      `重新开放时长必须在 1 ~ ${MAX_REOPEN_MINUTES} 分钟之间`,
    )
  }

  return runInTransaction(prisma, async (tx) => {
    const entry = await requireEntry(tx, input.entryId)

    // pending 时重开是「延长窗口」而不是状态迁移，但仍然刷新截止时间
    assertTransition(entry, input.version, 'pending', '重新开放')

    const now = new Date()
    // reopenExpiresAt 是重开的全部意义所在：没有它，这个槽位就永久绕过了每日截止校验（§16.5）
    const reopenExpiresAt = new Date(now.getTime() + input.reopenMinutes * 60_000)

    let updated
    try {
      updated = await tx.checkinEntry.update({
        where: { id: entry.id, version: entry.version },
        data: {
          status: 'pending',
          version: { increment: 1 },
          reopenExpiresAt,
          // 回到待审核等于上一轮审核结论作废；审核痕迹保留在 review_actions 里备查
          reviewedAt: null,
          reviewedBy: null,
          rejectionCode: null,
          rejectionReason: null,
        },
      })
    } catch (error) {
      if (isRecordNotFound(error)) throw reviewConflict(entry.version)
      throw error
    }

    await tx.reviewAction.create({
      data: {
        entryId: entry.id,
        revisionId: entry.currentRevisionId,
        reviewerId: input.actor.userId,
        action: REVIEW_ACTION.reopen,
        reason: input.reason,
        reasonCode: null,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'checkin.reopen',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: { status: entry.status, version: entry.version, reopen_expires_at: entry.reopenExpiresAt?.toISOString() ?? null },
        after: {
          status: updated.status,
          version: updated.version,
          reopen_expires_at: updated.reopenExpiresAt?.toISOString() ?? null,
          reopen_minutes: input.reopenMinutes,
          reason: input.reason,
        },
      },
      tx,
    )

    const submittable = (SUBMITTABLE_CAMPAIGN_STATUSES as readonly string[]).includes(entry.campaignStatus)
    return {
      ...toEntryState(updated),
      campaign_submittable: submittable,
      warning: submittable
        ? null
        : `活动当前状态为 ${entry.campaignStatus}，参赛者此时无法提交，本次重开只解除截止时间限制。`,
    }
  })
}

// ---------------------------------------------------------------------------
// §8.5 撤销审核结果
// ---------------------------------------------------------------------------

export interface RevokeEntryInput {
  entryId: string
  version: number
  reason: string
  actor: AdminActor
  audit: AuditContext
}

export async function revokeEntry(input: RevokeEntryInput): Promise<EntryStatePayload> {
  const prisma = getPrismaClient()

  return runInTransaction(prisma, async (tx) => {
    const entry = await requireEntry(tx, input.entryId)

    // 状态机只允许 approved → revoked：撤销的是「审核结论」，没通过过就无从撤销。
    // 这里刻意不看 reopenExpiresAt —— 重开窗口是否还在，不影响能否撤销。
    assertTransition(entry, input.version, 'revoked', '撤销审核结果')

    let updated
    try {
      updated = await tx.checkinEntry.update({
        where: { id: entry.id, version: entry.version },
        data: {
          status: 'revoked',
          version: { increment: 1 },
          // 保留原 reviewedAt/reviewedBy：它们记录的是「谁批准的」，撤销本身另有审计
        },
      })
    } catch (error) {
      if (isRecordNotFound(error)) throw reviewConflict(entry.version)
      throw error
    }

    await tx.reviewAction.create({
      data: {
        entryId: entry.id,
        revisionId: entry.currentRevisionId,
        reviewerId: input.actor.userId,
        action: REVIEW_ACTION.revoke,
        reason: input.reason,
        reasonCode: null,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'review.revoke',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: { status: entry.status, version: entry.version },
        after: { status: updated.status, version: updated.version, reason: input.reason },
      },
      tx,
    )

    return toEntryState(updated)
  })
}

// ---------------------------------------------------------------------------
// §8.5 作废违规记录
// ---------------------------------------------------------------------------

export interface VoidEntryInput {
  entryId: string
  version: number
  reason: string
  actor: AdminActor
  audit: AuditContext
}

export async function voidEntry(input: VoidEntryInput): Promise<EntryStatePayload> {
  const prisma = getPrismaClient()

  return runInTransaction(prisma, async (tx) => {
    const entry = await requireEntry(tx, input.entryId)

    // 刻意的实现取舍：§6.4 的状态图画的是 rejected → void，
    // 但 §8.5 把「作废违规记录」列为独立操作，而违规可能在待审核或已通过时才被发现。
    // 因此这里允许从任意状态作废，唯一拒绝的是已经作废的记录 —— 作废是终态。
    if (entry.version !== input.version) throw reviewConflict(entry.version)
    if (entry.status === 'void') {
      throw new AppError('STATE_TRANSITION_INVALID', '该记录已经作废，无需重复操作')
    }

    let updated
    try {
      updated = await tx.checkinEntry.update({
        where: { id: entry.id, version: entry.version },
        data: {
          status: 'void',
          version: { increment: 1 },
          // 作废不等于撤销审核：原始审核结果留在 reviewedAt/reviewedBy 与 review_actions 里，
          // 供申诉或事后复查时还原当时的判断过程
        },
      })
    } catch (error) {
      if (isRecordNotFound(error)) throw reviewConflict(entry.version)
      throw error
    }

    await tx.reviewAction.create({
      data: {
        entryId: entry.id,
        revisionId: entry.currentRevisionId,
        reviewerId: input.actor.userId,
        action: REVIEW_ACTION.void,
        reason: input.reason,
        reasonCode: null,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'review.void',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: { status: entry.status, version: entry.version },
        after: { status: updated.status, version: updated.version, reason: input.reason },
      },
      tx,
    )

    return toEntryState(updated)
  })
}

// ---------------------------------------------------------------------------
// §8.5 管理员补录
// ---------------------------------------------------------------------------

export interface CreateManualEntryInput {
  participantId: string
  /** 赛道 id 或 slug */
  trackRef: string
  activityDate: string
  reason: string
  note?: string | undefined
  status: 'pending' | 'approved'
  actor: AdminActor
  audit: AuditContext
}

export interface ManualEntryPayload extends EntryStatePayload {
  participant_id: string
  track_id: string
  track_slug: string
  revision_id: string
}

export async function createManualEntry(input: CreateManualEntryInput): Promise<ManualEntryPayload> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign()

  const participant = await prisma.campaignParticipant.findFirst({
    where: { id: input.participantId, campaignId: campaign.id },
    select: { id: true, status: true, user: { select: { studentId: true, name: true } } },
  })
  if (!participant) throw notFound('该参赛者不在当前活动中')
  if (participant.status !== 'active') {
    throw new AppError('VALIDATION_FAILED', '该参赛者已禁用或已匿名化，不能补录记录')
  }

  const campaignTrack = campaign.campaignTracks.find(
    (item) => item.trackId === input.trackRef || item.track.slug === input.trackRef,
  )
  if (!campaignTrack) throw notFound('该赛道未在此活动中启用')
  if (!campaignTrack.enabled) throw new AppError('TRACK_DISABLED', '该赛道已停用，不能补录记录')

  // 补录日期必须落在活动区间内，否则这条记录永远不会被计入任何一天的统计
  if (input.activityDate < campaign.startDate || input.activityDate > campaign.endDate) {
    throw new AppError(
      'VALIDATION_FAILED',
      `补录日期必须在活动区间 ${campaign.startDate} ~ ${campaign.endDate} 之内`,
    )
  }

  const trackId = campaignTrack.trackId
  const trackSlug = campaignTrack.track.slug

  const result = await runInTransaction(prisma, async (tx) => {
    // 唯一约束 (participant_id, track_id, activity_date)：补录只能新增槽位，不能覆盖已有记录。
    // 先查一次是为了给出可读的错误，真正的保证仍来自数据库唯一索引。
    const existing = await tx.checkinEntry.findUnique({
      where: {
        participantId_trackId_activityDate: {
          participantId: participant.id,
          trackId,
          activityDate: input.activityDate,
        },
      },
      select: { id: true, status: true },
    })
    if (existing) {
      throw new AppError('DUPLICATE_SUBMISSION', '该参赛者在此赛道该活动日已有记录，如需修正请使用重新开放或撤销', {
        details: { entry_id: existing.id, status: existing.status },
      })
    }

    const now = new Date()
    const approved = input.status === 'approved'

    const entry = await tx.checkinEntry.create({
      data: {
        campaignId: campaign.id,
        participantId: participant.id,
        trackId,
        activityDate: input.activityDate,
        status: input.status,
        currentSubmittedAt: now,
        isManual: true,
        createdBy: input.actor.userId,
        // 直接判为通过时把审核人也记成操作者本人，保证「通过」这件事有归属
        reviewedAt: approved ? now : null,
        reviewedBy: approved ? input.actor.userId : null,
      },
    })

    // 补录没有参赛者上传的材料版本，但仍然要有一个版本作为「当前版本」，
    // 否则详情页和审核历史会指向空，review_actions.revision_id 也无处可挂
    const revision = await tx.submissionRevision.create({
      data: {
        entryId: entry.id,
        revisionNumber: 1,
        note: input.note ? `管理员补录：${input.reason}；备注：${input.note}` : `管理员补录：${input.reason}`,
        submittedAt: now,
        submittedBy: input.actor.userId,
      },
    })

    const updated = await tx.checkinEntry.update({
      where: { id: entry.id },
      data: { currentRevisionId: revision.id },
    })

    await tx.reviewAction.create({
      data: {
        entryId: entry.id,
        revisionId: revision.id,
        reviewerId: input.actor.userId,
        action: REVIEW_ACTION.manualCreate,
        reason: input.reason,
        reasonCode: null,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'checkin.manual_create',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: null,
        after: {
          status: updated.status,
          version: updated.version,
          participant_id: participant.id,
          student_id: participant.user.studentId,
          track_slug: trackSlug,
          activity_date: input.activityDate,
          revision_id: revision.id,
          reason: input.reason,
        },
      },
      tx,
    )

    return { updated, revisionId: revision.id }
  })

  return {
    ...toEntryState(result.updated),
    participant_id: participant.id,
    track_id: trackId,
    track_slug: trackSlug,
    revision_id: result.revisionId,
  }
}

// ---------------------------------------------------------------------------
// §9.1 积分调整
// ---------------------------------------------------------------------------

export interface CreateScoreAdjustmentInput {
  participantId: string
  /** 赛道 id 或 slug，或总榜哨兵值 __overall__ */
  trackRef: string
  pointsDelta: number
  reason: string
  actor: AdminActor
  audit: AuditContext
}

export interface ScoreAdjustmentPayload {
  adjustment_id: string
  campaign_id: string
  participant_id: string
  track_id: string
  points_delta: number
  reason: string
  operator_id: string | null
  created_at: string
}

export async function createScoreAdjustment(
  input: CreateScoreAdjustmentInput,
): Promise<ScoreAdjustmentPayload> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign()

  const participant = await prisma.campaignParticipant.findFirst({
    where: { id: input.participantId, campaignId: campaign.id },
    select: { id: true, status: true },
  })
  if (!participant) throw notFound('该参赛者不在当前活动中')

  // score_adjustments.track_id 存的是赛道 slug 而不是外键：
  // 总榜哨兵值 __overall__ 不在 tracks 表里，可空列又会破坏唯一性假设（§11.2）
  let trackSlug: string
  if (input.trackRef === OVERALL_TRACK_SENTINEL) {
    trackSlug = OVERALL_TRACK_SENTINEL
  } else {
    const track = await prisma.track.findFirst({
      where: { OR: [{ id: input.trackRef }, { slug: input.trackRef }] },
      select: { id: true, slug: true },
    })
    if (!track) throw notFound('赛道不存在')
    const enabledInCampaign = campaign.campaignTracks.some((item) => item.trackId === track.id)
    if (!enabledInCampaign) throw notFound('该赛道未在此活动中启用')
    trackSlug = track.slug
  }

  const adjustment = await runInTransaction(prisma, async (tx) => {
    // §9.1：人工调整不得直接修改原始积分字段，只单独建立调整记录。
    // 因此这里没有任何 update，只有一条 insert；before 恒为 null 正是这个意思。
    const created = await tx.scoreAdjustment.create({
      data: {
        campaignId: campaign.id,
        participantId: participant.id,
        trackId: trackSlug,
        pointsDelta: input.pointsDelta,
        reason: input.reason,
        operatorId: input.actor.userId,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'score.adjust',
        targetType: 'score_adjustment',
        targetId: created.id,
        before: null,
        after: {
          campaign_id: campaign.id,
          participant_id: participant.id,
          track_id: trackSlug,
          points_delta: input.pointsDelta,
          reason: input.reason,
        },
      },
      tx,
    )

    return created
  })

  return {
    adjustment_id: adjustment.id,
    campaign_id: adjustment.campaignId,
    participant_id: adjustment.participantId,
    track_id: adjustment.trackId,
    points_delta: adjustment.pointsDelta,
    reason: adjustment.reason,
    operator_id: adjustment.operatorId,
    created_at: adjustment.createdAt.toISOString(),
  }
}
