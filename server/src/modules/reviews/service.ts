import {
  REJECT_REASON_CODES,
  REVIEWABLE_CAMPAIGN_STATUSES,
  type EntryStatus,
  type RejectReasonCode,
  type ReviewActionType,
  type UserRole,
} from '../../config/constants.js'
import { AppError, notFound } from '../../core/errors.js'
import { cstInstantOf, cstToday } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { auditContextFrom, recordAudit } from '../../services/audit.service.js'
import { requireCurrentCampaign } from '../campaigns/service.js'

/**
 * §8.2 流水线审核页面的服务端实现。
 *
 * 审核是「两个人可能同时打开同一条记录」的典型场景，因此这里所有写操作
 * 都按 §16.8 用 checkin_entries.version 做乐观并发控制：详情面板把 version
 * 交给前端，审核时回传，只有版本仍然一致的那一次审核会落库。
 */

/** recordAudit 需要的请求上下文，由路由层用 auditContextFrom(req) 组装好传进来 */
export type AuditContext = ReturnType<typeof auditContextFrom>

/** code → 中文标签，用于把「只选了预设原因」的驳回补成可读文本 */
const REJECT_REASON_LABELS = new Map<string, string>(
  REJECT_REASON_CODES.map((item) => [item.code, item.label] as const),
)

/**
 * review_actions.action 的取值。
 * 用 satisfies 挂到 constants.REVIEW_ACTIONS 上：写错动作名会在编译期报错，
 * 而不是等到运行时往库里写一个非法值。
 */
const REVIEW_ACTION = {
  approve: 'approve',
  reject: 'reject',
} as const satisfies Record<string, ReviewActionType>

// ---------------------------------------------------------------------------
// 队列（§8.2 左侧面板）
// ---------------------------------------------------------------------------

export interface ReviewQueueItem {
  entry_id: string
  participant: {
    id: string
    student_id: string
    name: string
    class_name: string | null
  }
  track: { id: string; slug: string; name: string }
  activity_date: string
  submitted_at: string
  revision_number: number
  asset_count: number
  /** 乐观并发令牌，审核时必须原样回传 */
  version: number
  /** 该槽位已经提交过多个版本，审核时值得多看一眼历史 */
  is_resubmission: boolean
}

/** 审核进度（§8.2 的「审核进度」区块） */
export interface ReviewProgress {
  pending_total: number
  reviewed_today: number
  approved_today: number
  rejected_today: number
}

export interface ReviewQueuePayload {
  entries: ReviewQueueItem[]
  total: number
  page: number
  page_size: number
  progress: ReviewProgress
}

interface QueueEntryLike {
  id: string
  activityDate: string
  version: number
  currentSubmittedAt: Date
  participant: { id: string; className: string | null; user: { studentId: string; name: string } }
  track: { id: string; slug: string; name: string }
  currentRevision: { revisionNumber: number; _count: { assets: number } } | null
  _count: { revisions: number }
}

function toQueueItem(entry: QueueEntryLike): ReviewQueueItem {
  return {
    entry_id: entry.id,
    participant: {
      id: entry.participant.id,
      student_id: entry.participant.user.studentId,
      name: entry.participant.user.name,
      class_name: entry.participant.className,
    },
    track: { id: entry.track.id, slug: entry.track.slug, name: entry.track.name },
    activity_date: entry.activityDate,
    submitted_at: entry.currentSubmittedAt.toISOString(),
    // 队列只展示「当前生效的那个版本」的材料（§16.4：重新提交后只有最新版本进队列）
    revision_number: entry.currentRevision?.revisionNumber ?? 0,
    asset_count: entry.currentRevision?._count.assets ?? 0,
    version: entry.version,
    is_resubmission: entry._count.revisions > 1,
  }
}

export interface ReviewQueueFilters {
  track?: string | undefined
  activityDate?: string | undefined
  className?: string | undefined
  page: number
  pageSize: number
}

export async function listReviewQueue(filters: ReviewQueueFilters): Promise<ReviewQueuePayload> {
  const prisma = getPrismaClient()
  // 审核队列只针对当前活动；没有进行中的活动时直接给出可读错误
  const campaign = await requireCurrentCampaign()

  const where = {
    campaignId: campaign.id,
    status: 'pending',
    ...(filters.track ? { track: { slug: filters.track } } : {}),
    ...(filters.activityDate ? { activityDate: filters.activityDate } : {}),
    // class_name 缺省即「全部班级」，不额外加条件
    ...(filters.className ? { participant: { className: filters.className } } : {}),
  }

  // 今天的起点按北京时间零点换算，与 activity_date 的归属规则保持一致（§6.2）
  const todayStart = cstInstantOf(cstToday(), '00:00')

  const [rows, total, pendingTotal, reviewedToday, approvedToday, rejectedToday] = await Promise.all([
    prisma.checkinEntry.findMany({
      where,
      // 先到先审：审核流水线按提交时间先进先出（§8.2）；id 作为次级排序保证分页稳定
      orderBy: [{ currentSubmittedAt: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        participant: {
          select: {
            id: true,
            className: true,
            user: { select: { studentId: true, name: true } },
          },
        },
        track: { select: { id: true, slug: true, name: true } },
        currentRevision: {
          select: { revisionNumber: true, _count: { select: { assets: true } } },
        },
        _count: { select: { revisions: true } },
      },
    }),
    prisma.checkinEntry.count({ where }),
    // 进度条统计整个活动，不随筛选器变化 —— 它衡量的是「还剩多少活没干」
    prisma.checkinEntry.count({ where: { campaignId: campaign.id, status: 'pending' } }),
    prisma.checkinEntry.count({ where: { campaignId: campaign.id, reviewedAt: { gte: todayStart } } }),
    prisma.checkinEntry.count({
      where: { campaignId: campaign.id, status: 'approved', reviewedAt: { gte: todayStart } },
    }),
    prisma.checkinEntry.count({
      where: { campaignId: campaign.id, status: 'rejected', reviewedAt: { gte: todayStart } },
    }),
  ])

  return {
    entries: rows.map(toQueueItem),
    total,
    page: filters.page,
    page_size: filters.pageSize,
    progress: {
      pending_total: pendingTotal,
      reviewed_today: reviewedToday,
      // 只统计「此刻仍是通过/驳回」的记录：今天审过但随后被撤销的记录不再计入
      approved_today: approvedToday,
      rejected_today: rejectedToday,
    },
  }
}

// ---------------------------------------------------------------------------
// 详情（§8.2 右侧面板）
// ---------------------------------------------------------------------------

export interface ReviewEntryDetail {
  entry_id: string
  status: EntryStatus
  version: number
  activity_date: string
  submitted_at: string
  is_manual: boolean
  is_resubmission: boolean
  reopen_expires_at: string | null
  participant: {
    id: string
    user_id: string
    student_id: string
    name: string
    class_name: string | null
    phone_suffix: string | null
    remark: string | null
    status: string
  }
  campaign: { id: string; name: string; status: string }
  track: { id: string; slug: string; name: string }
  current_revision: {
    revision_id: string
    revision_number: number
    note: string | null
    submitted_at: string
    assets: Array<{ asset_id: string; width: number | null; height: number | null; sort_order: number }>
  } | null
  history: {
    review_actions: Array<{
      id: string
      action: ReviewActionType
      reason: string | null
      reason_code: string | null
      revision_id: string | null
      reviewer: { id: string; name: string } | null
      created_at: string
    }>
    /** 历史版本只给摘要，材料本身留在库里备查 */
    previous_revisions: Array<{
      revision_number: number
      submitted_at: string
      note: string | null
      asset_count: number
    }>
  }
}

export async function getReviewEntryDetail(entryId: string): Promise<ReviewEntryDetail> {
  const prisma = getPrismaClient()

  const entry = await prisma.checkinEntry.findUnique({
    where: { id: entryId },
    include: {
      campaign: { select: { id: true, name: true, status: true } },
      participant: {
        include: { user: { select: { studentId: true, name: true } } },
      },
      track: { select: { id: true, slug: true, name: true } },
      currentRevision: {
        include: { assets: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      },
      // 审核历史倒序：离现在最近的一次决定排在最上面
      reviewActions: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { reviewer: { select: { id: true, name: true } } },
      },
      revisions: {
        orderBy: [{ revisionNumber: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          revisionNumber: true,
          submittedAt: true,
          note: true,
          _count: { select: { assets: true } },
        },
      },
    },
  })

  if (!entry) throw notFound('打卡记录不存在')

  const currentRevisionId = entry.currentRevisionId

  return {
    entry_id: entry.id,
    status: entry.status as EntryStatus,
    version: entry.version,
    activity_date: entry.activityDate,
    submitted_at: entry.currentSubmittedAt.toISOString(),
    is_manual: entry.isManual,
    is_resubmission: entry.revisions.length > 1,
    reopen_expires_at: entry.reopenExpiresAt?.toISOString() ?? null,
    participant: {
      id: entry.participant.id,
      user_id: entry.participant.userId,
      student_id: entry.participant.user.studentId,
      name: entry.participant.user.name,
      class_name: entry.participant.className,
      phone_suffix: entry.participant.phoneSuffix,
      remark: entry.participant.remark,
      status: entry.participant.status,
    },
    campaign: { id: entry.campaign.id, name: entry.campaign.name, status: entry.campaign.status },
    track: { id: entry.track.id, slug: entry.track.slug, name: entry.track.name },
    current_revision: entry.currentRevision
      ? {
          revision_id: entry.currentRevision.id,
          revision_number: entry.currentRevision.revisionNumber,
          note: entry.currentRevision.note,
          submitted_at: entry.currentRevision.submittedAt.toISOString(),
          assets: entry.currentRevision.assets.map((asset) => ({
            asset_id: asset.id,
            width: asset.width,
            height: asset.height,
            sort_order: asset.sortOrder,
          })),
        }
      : null,
    history: {
      review_actions: entry.reviewActions.map((action) => ({
        id: action.id,
        action: action.action as ReviewActionType,
        reason: action.reason,
        reason_code: action.reasonCode,
        revision_id: action.revisionId,
        reviewer: action.reviewer,
        created_at: action.createdAt.toISOString(),
      })),
      previous_revisions: entry.revisions
        .filter((revision) => revision.id !== currentRevisionId)
        .map((revision) => ({
          revision_number: revision.revisionNumber,
          submitted_at: revision.submittedAt.toISOString(),
          note: revision.note,
          asset_count: revision._count.assets,
        })),
    },
  }
}

// ---------------------------------------------------------------------------
// 审核动作
// ---------------------------------------------------------------------------

export interface ReviewResult {
  entry_id: string
  status: EntryStatus
  version: number
  reviewed_at: string | null
  reviewed_by: string | null
  rejection_code: string | null
  rejection_reason: string | null
  action: ReviewActionType
}

interface ReviewedEntryLike {
  id: string
  status: string
  version: number
  reviewedAt: Date | null
  reviewedBy: string | null
  rejectionCode: string | null
  rejectionReason: string | null
}

function toReviewResult(entry: ReviewedEntryLike, action: ReviewActionType): ReviewResult {
  return {
    entry_id: entry.id,
    status: entry.status as EntryStatus,
    version: entry.version,
    reviewed_at: entry.reviewedAt?.toISOString() ?? null,
    reviewed_by: entry.reviewedBy,
    rejection_code: entry.rejectionCode,
    rejection_reason: entry.rejectionReason,
    action,
  }
}

/** §8.2：版本号对不上说明记录已被别人改过，前端需要刷新后继续 */
function reviewConflict(currentVersion: number): AppError {
  return new AppError('REVIEW_CONFLICT', '该记录在你打开详情后被其他人修改过，请刷新后重新审核', {
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
 * 审核窗口校验。
 *
 * active / settling 之外（finished、archived，即排行榜冻结之后）普通审核员不得再改动记录，
 * 否则会破坏已冻结的最终榜单（§16.15）。超管仍可走完流程，但调用方要在审计里标记 override。
 */
function assertReviewWindowOpen(role: UserRole, campaignStatus: string): boolean {
  if ((REVIEWABLE_CAMPAIGN_STATUSES as readonly string[]).includes(campaignStatus)) return false
  if (role !== 'super_admin') {
    throw new AppError(
      'CAMPAIGN_FROZEN',
      `活动当前状态为 ${campaignStatus}，已停止审核；如确需修改请联系超级管理员`,
    )
  }
  return true
}

interface EntryUnderReview {
  id: string
  status: string
  version: number
  currentRevisionId: string | null
  campaignStatus: string
}

/** 事务内读取待审核记录，并完成并发与状态校验 */
async function loadEntryForReview(
  tx: Db,
  entryId: string,
  expectedVersion: number,
  role: UserRole,
): Promise<{ entry: EntryUnderReview; overridden: boolean }> {
  const entry = await tx.checkinEntry.findUnique({
    where: { id: entryId },
    include: { campaign: { select: { status: true } } },
  })
  if (!entry) throw notFound('打卡记录不存在')

  if (entry.version !== expectedVersion) throw reviewConflict(entry.version)
  if (entry.status !== 'pending') {
    throw new AppError(
      'STATE_TRANSITION_INVALID',
      `只有待审核的记录可以审核，该记录当前状态为 ${entry.status}`,
    )
  }

  return {
    entry: {
      id: entry.id,
      status: entry.status,
      version: entry.version,
      currentRevisionId: entry.currentRevisionId,
      campaignStatus: entry.campaign.status,
    },
    overridden: assertReviewWindowOpen(role, entry.campaign.status),
  }
}

export interface ApproveReviewInput {
  entryId: string
  version: number
  note?: string | undefined
  actor: { userId: string; role: UserRole }
  audit: AuditContext
}

export async function approveReview(input: ApproveReviewInput): Promise<ReviewResult> {
  const prisma = getPrismaClient()

  return runInTransaction(prisma, async (tx) => {
    const { entry, overridden } = await loadEntryForReview(tx, input.entryId, input.version, input.actor.role)

    const now = new Date()
    let updated
    try {
      updated = await tx.checkinEntry.update({
        // 把 version 一并写进 where：即使是并发事务同时通过了上一行的检查，
        // 也只有第一个能匹配到行，第二个会因记录不存在而失败（§16.8 双保险）
        where: { id: entry.id, version: entry.version },
        data: {
          status: 'approved',
          version: { increment: 1 },
          reviewedAt: now,
          reviewedBy: input.actor.userId,
          // 通过即清除上一轮的驳回痕迹，避免参赛者同时看到「已通过」和驳回原因
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
        action: REVIEW_ACTION.approve,
        reason: input.note ?? null,
        reasonCode: null,
      },
    })

    // 审计与业务写入同事务提交：审核结论不允许出现「改了但没记录」
    await recordAudit(
      {
        ...input.audit,
        action: 'review.approve',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: { status: entry.status, version: entry.version },
        after: {
          status: updated.status,
          version: updated.version,
          rejection_code: null,
          note: input.note ?? null,
          campaign_status_override: overridden ? entry.campaignStatus : null,
        },
      },
      tx,
    )

    return toReviewResult(updated, REVIEW_ACTION.approve)
  })
}

export interface RejectReviewInput {
  entryId: string
  version: number
  reasonCode: RejectReasonCode
  reason?: string | undefined
  actor: { userId: string; role: UserRole }
  audit: AuditContext
}

export async function rejectReview(input: RejectReviewInput): Promise<ReviewResult> {
  const prisma = getPrismaClient()
  // 只选了预设原因时用预设标签兜底，保证 checkin_entries.rejection_reason 永远是可读文本；
  // 结构化取值仍以 rejection_code 为准
  const reasonText = input.reason ?? REJECT_REASON_LABELS.get(input.reasonCode) ?? input.reasonCode

  return runInTransaction(prisma, async (tx) => {
    const { entry, overridden } = await loadEntryForReview(tx, input.entryId, input.version, input.actor.role)

    const now = new Date()
    let updated
    try {
      updated = await tx.checkinEntry.update({
        where: { id: entry.id, version: entry.version },
        data: {
          status: 'rejected',
          version: { increment: 1 },
          reviewedAt: now,
          reviewedBy: input.actor.userId,
          rejectionCode: input.reasonCode,
          rejectionReason: reasonText,
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
        action: REVIEW_ACTION.reject,
        reason: reasonText,
        reasonCode: input.reasonCode,
      },
    })

    await recordAudit(
      {
        ...input.audit,
        action: 'review.reject',
        targetType: 'checkin_entry',
        targetId: entry.id,
        before: { status: entry.status, version: entry.version },
        after: {
          status: updated.status,
          version: updated.version,
          reason_code: input.reasonCode,
          reason: reasonText,
          campaign_status_override: overridden ? entry.campaignStatus : null,
        },
      },
      tx,
    )

    return toReviewResult(updated, REVIEW_ACTION.reject)
  })
}
