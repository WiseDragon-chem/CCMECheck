import { SUBMITTABLE_CAMPAIGN_STATUSES, type EntryStatus } from '../../config/constants.js'
import { randomObjectKey } from '../../core/crypto.js'
import { AppError, notFound } from '../../core/errors.js'
import type { AuthPrincipal } from '../../core/principal.js'
import { isSubmissionAllowed, toActivityDate, windowState } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import type { UploadedFile } from '../../middleware/upload.js'
import { processImage, type ProcessedImage } from '../../services/image.service.js'
import { computeTrackScore, type ScoringAdjustment, type ScoringEntry } from '../../services/scoring.service.js'
import { getStorage } from '../../storage/index.js'
import { requireCurrentCampaign } from '../campaigns/service.js'
import type { ListCheckinsQuery, SubmitCheckinFields } from './schema.js'

/**
 * 打卡模块（design.md §6.3、§6.4、§7.3、§7.4、§7.5）。
 *
 * 一个打卡槽位由 (参赛者, 赛道, 活动日) 唯一确定；重新提交产生新版本，
 * 不会创建第二个有效槽位。
 */

/** §7.3 的卡片状态。`invalid` 是对 revoked/void 的补充 —— 设计文档的状态表没有覆盖这两种管理员处置结果 */
export type CardState = 'before_open' | 'can_submit' | 'pending' | 'approved' | 'rejected' | 'missed' | 'invalid'

export interface TodayCard {
  track_id: string
  slug: string
  name: string
  icon: string | null
  proof_instructions: string | null
  card_state: CardState
  can_submit: boolean
  entry_id: string | null
  status: EntryStatus | null
  rejection_reason: string | null
  rejection_code: string | null
  submitted_at: string | null
  reviewed_at: string | null
  /**
   * 该槽位被管理员临时重新开放到什么时候（design.md §8.5）。
   *
   * 没有这个字段，接口会因为重开而返回 can_submit: true，
   * 但前端无从解释「为什么已过截止还能交」、也说不清何时失效。
   */
  reopen_expires_at: string | null
  valid_days: number
  track_score: number
  daily_points: number
  daily_cap: number | null
  campaign_cap: number | null
  overall_weight: number
}

export interface TodayOverview {
  is_participant: boolean
  participant_id: string | null
  campaign: {
    id: string
    name: string
    status: string
    start_date: string
    end_date: string
    daily_open_time: string
    daily_deadline: string
  }
  activity_date: string
  server_time: string
  /** 距离今日截止的秒数；已截止或未开放时为 null */
  seconds_to_deadline: number | null
  total_valid_days: number
  total_score: number
  cards: TodayCard[]
}

// ---------------------------------------------------------------------------
// 参赛者解析
// ---------------------------------------------------------------------------

export async function resolveParticipant(
  campaignId: string,
  userId: string,
  db: Db = getPrismaClient(),
) {
  return db.campaignParticipant.findUnique({
    where: { campaignId_userId: { campaignId, userId } },
  })
}

// ---------------------------------------------------------------------------
// 今日概览
// ---------------------------------------------------------------------------

export async function getTodayOverview(principal: AuthPrincipal, now: Date = new Date()): Promise<TodayOverview> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const activityDate = toActivityDate(now)

  const participant = await resolveParticipant(campaign.id, principal.userId, prisma)

  const base = {
    is_participant: participant !== null && participant.status === 'active',
    participant_id: participant?.id ?? null,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      start_date: campaign.startDate,
      end_date: campaign.endDate,
      daily_open_time: campaign.dailyOpenTime,
      daily_deadline: campaign.dailyDeadline,
    },
    activity_date: activityDate,
    server_time: now.toISOString(),
  }

  if (!participant || participant.status !== 'active') {
    // 审核员与超管可能本身不是参赛者（design.md §5「可同时作为参赛者」），
    // 此时返回空卡片而不是报错，页面照常可看
    return {
      ...base,
      seconds_to_deadline: null,
      total_valid_days: 0,
      total_score: 0,
      cards: [],
    }
  }

  const enabledTracks = campaign.campaignTracks.filter((item) => item.enabled)

  const entries = await prisma.checkinEntry.findMany({
    where: { participantId: participant.id, activityDate },
  })
  const entryByTrack = new Map(entries.map((entry) => [entry.trackId, entry]))

  // 该参赛者的全部通过记录与调整，用于计算赛道累计积分与有效天数
  const [approvedEntries, adjustments] = await Promise.all([
    prisma.checkinEntry.findMany({
      where: {
        participantId: participant.id,
        status: 'approved',
        activityDate: { lte: activityDate },
      },
      select: { trackId: true, activityDate: true, reviewedAt: true, track: { select: { slug: true } } },
    }),
    prisma.scoreAdjustment.findMany({
      where: { participantId: participant.id, campaignId: campaign.id },
      select: { trackId: true, pointsDelta: true, createdAt: true },
    }),
  ])

  const entriesBySlug = new Map<string, ScoringEntry[]>()
  for (const entry of approvedEntries) {
    const list = entriesBySlug.get(entry.track.slug)
    const item: ScoringEntry = {
      trackSlug: entry.track.slug,
      activityDate: entry.activityDate,
      reviewedAt: entry.reviewedAt,
    }
    if (list) list.push(item)
    else entriesBySlug.set(entry.track.slug, [item])
  }

  const adjustmentsBySlug = new Map<string, ScoringAdjustment[]>()
  for (const adjustment of adjustments) {
    const list = adjustmentsBySlug.get(adjustment.trackId)
    const item: ScoringAdjustment = {
      trackSlug: adjustment.trackId,
      pointsDelta: adjustment.pointsDelta,
      createdAt: adjustment.createdAt,
    }
    if (list) list.push(item)
    else adjustmentsBySlug.set(adjustment.trackId, [item])
  }

  const cards: TodayCard[] = enabledTracks.map((campaignTrack) => {
    const slug = campaignTrack.track.slug
    const entry = entryByTrack.get(campaignTrack.trackId)

    const reopenExpiresAt = entry?.reopenExpiresAt ?? null
    const allowed = isSubmissionAllowed({
      activityDate,
      dailyOpenTime: campaign.dailyOpenTime,
      dailyDeadline: campaign.dailyDeadline,
      now,
      reopenExpiresAt,
    })
    const state = windowState(activityDate, campaign.dailyOpenTime, campaign.dailyDeadline, now)

    // §6.4 的状态机：参赛者只能从 pending 或 rejected 重新提交；
    // approved 需要管理员重新打开，revoked / void 对参赛者是终态
    const reSubmittable = entry ? entry.status === 'pending' || entry.status === 'rejected' : true

    // 活动本身也要接受提交：进入 settling / finished 后 submitCheckin 会抛 CAMPAIGN_NOT_ACTIVE。
    // 这里若不同步判断，接口会对未打卡的赛道返回 can_submit: true，
    // 界面显示「去打卡」，点下去必然失败 —— 前端不该被喂一个自己会拒绝的答案。
    //
    // 注意：只改这一个布尔值，不要把「为什么不能提交」编码进 card_state。
    // 响应里已有 campaign.status，前端据此渲染活动状态横幅即可，
    // can_submit 的语义保持单一：服务器此刻是否接受提交。
    const campaignAcceptsSubmissions = SUBMITTABLE_CAMPAIGN_STATUSES.includes(campaign.status as never)
    const canSubmit = allowed && reSubmittable && campaignAcceptsSubmissions

    let cardState: CardState
    if (entry) {
      switch (entry.status) {
        case 'approved':
          cardState = 'approved'
          break
        case 'pending':
          cardState = 'pending'
          break
        case 'rejected':
          cardState = 'rejected'
          break
        default:
          cardState = 'invalid'
      }
    } else if (allowed) {
      cardState = 'can_submit'
    } else if (state === 'before_open') {
      cardState = 'before_open'
    } else {
      cardState = 'missed'
    }

    const trackScore = computeTrackScore({
      config: {
        trackId: campaignTrack.trackId,
        slug,
        dailyPoints: campaignTrack.dailyPoints,
        dailyCap: campaignTrack.dailyCap,
        campaignCap: campaignTrack.campaignCap,
        overallWeight: campaignTrack.overallWeight,
        enabled: campaignTrack.enabled,
      },
      entries: entriesBySlug.get(slug) ?? [],
      adjustments: adjustmentsBySlug.get(slug) ?? [],
    })

    return {
      track_id: campaignTrack.trackId,
      slug,
      name: campaignTrack.track.name,
      icon: campaignTrack.track.icon,
      proof_instructions: campaignTrack.proofInstructions ?? campaignTrack.track.proofInstructions,
      card_state: cardState,
      can_submit: canSubmit,
      entry_id: entry?.id ?? null,
      status: (entry?.status as EntryStatus) ?? null,
      rejection_reason: entry?.rejectionReason ?? null,
      rejection_code: entry?.rejectionCode ?? null,
      submitted_at: entry?.currentSubmittedAt.toISOString() ?? null,
      reviewed_at: entry?.reviewedAt?.toISOString() ?? null,
      reopen_expires_at: entry?.reopenExpiresAt?.toISOString() ?? null,
      valid_days: trackScore.validDays,
      track_score: trackScore.score,
      daily_points: campaignTrack.dailyPoints,
      daily_cap: campaignTrack.dailyCap,
      campaign_cap: campaignTrack.campaignCap,
      overall_weight: campaignTrack.overallWeight,
    }
  })

  const deadline = campaign.campaignTracks.length
    ? new Date(`${activityDate}T${campaign.dailyDeadline}:00+08:00`)
    : null
  const secondsToDeadline = deadline && deadline.getTime() > now.getTime()
    ? Math.floor((deadline.getTime() - now.getTime()) / 1000)
    : null

  const overallTrackSlug = cards.map((card) => card.slug)
  const totalValidDays = new Set(
    approvedEntries.filter((entry) => overallTrackSlug.includes(entry.track.slug)).map((entry) => entry.activityDate),
  ).size

  return {
    ...base,
    seconds_to_deadline: secondsToDeadline,
    total_valid_days: totalValidDays,
    total_score: cards.reduce((sum, card) => sum + card.track_score, 0),
    cards,
  }
}

// ---------------------------------------------------------------------------
// 个人记录
// ---------------------------------------------------------------------------

export interface CheckinListItem {
  entry_id: string
  track: { slug: string; name: string }
  activity_date: string
  status: EntryStatus
  version: number
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  rejection_code: string | null
  note: string | null
  asset_count: number
  can_resubmit: boolean
}

export async function listCheckins(
  principal: AuthPrincipal,
  query: ListCheckinsQuery,
  now: Date = new Date(),
): Promise<{
  items: CheckinListItem[]
  total: number
  page: number
  page_size: number
  is_participant: boolean
}> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const participant = await resolveParticipant(campaign.id, principal.userId, prisma)

  if (!participant || participant.status !== 'active') {
    // 与 /checkins/today 同样的口径（design.md §5「可同时作为参赛者」）：
    // 审核员与超管可能本身不是参赛者，这是**正常的空状态而不是权限错误**。
    // 这里报 403 的话，前端只有一个笼统的 FORBIDDEN 文案可用，页面会把
    // 「你不是参赛者」显示成「没有权限执行该操作」—— 用户据此完全不知道该怎么办。
    return {
      items: [],
      total: 0,
      page: query.page,
      page_size: query.page_size,
      is_participant: false,
    }
  }

  const where = {
    participantId: participant.id,
    ...(query.status ? { status: query.status } : {}),
    ...(query.track ? { track: { slug: query.track } } : {}),
    ...(query.from || query.to
      ? {
          activityDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  }

  const [total, entries] = await Promise.all([
    prisma.checkinEntry.count({ where }),
    prisma.checkinEntry.findMany({
      where,
      // §7.5：记录页按日期倒序
      orderBy: [{ activityDate: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      include: {
        track: { select: { slug: true, name: true } },
        currentRevision: { select: { note: true, submittedAt: true, _count: { select: { assets: true } } } },
      },
    }),
  ])

  const items: CheckinListItem[] = entries.map((entry) => {
    const allowed = isSubmissionAllowed({
      activityDate: entry.activityDate,
      dailyOpenTime: campaign.dailyOpenTime,
      dailyDeadline: campaign.dailyDeadline,
      now,
      reopenExpiresAt: entry.reopenExpiresAt,
    })
    const reSubmittable = entry.status === 'pending' || entry.status === 'rejected'

    return {
      entry_id: entry.id,
      track: { slug: entry.track.slug, name: entry.track.name },
      activity_date: entry.activityDate,
      status: entry.status as EntryStatus,
      version: entry.version,
      submitted_at: entry.currentSubmittedAt.toISOString(),
      reviewed_at: entry.reviewedAt?.toISOString() ?? null,
      rejection_reason: entry.rejectionReason,
      rejection_code: entry.rejectionCode,
      note: entry.currentRevision?.note ?? null,
      asset_count: entry.currentRevision?._count.assets ?? 0,
      can_resubmit: allowed && reSubmittable,
    }
  })

  return { items, total, page: query.page, page_size: query.page_size, is_participant: true }
}

export interface CheckinDetail {
  entry_id: string
  track: { slug: string; name: string; proof_instructions: string | null }
  activity_date: string
  status: EntryStatus
  version: number
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  rejection_code: string | null
  reopen_expires_at: string | null
  current_revision: {
    revision_number: number
    note: string | null
    submitted_at: string
    assets: Array<{ asset_id: string; width: number | null; height: number | null; mime_type: string; size: number }>
  } | null
  /** §7.5：历史版本默认折叠 */
  history: Array<{
    revision_number: number
    note: string | null
    submitted_at: string
    asset_count: number
  }>
}

export async function getCheckinDetail(
  principal: AuthPrincipal,
  entryId: string,
  now: Date = new Date(),
): Promise<CheckinDetail> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const participant = await resolveParticipant(campaign.id, principal.userId, prisma)
  if (!participant || participant.status !== 'active') {
    throw new AppError('FORBIDDEN', '当前账号不是该活动的参赛者')
  }

  const entry = await prisma.checkinEntry.findUnique({
    where: { id: entryId },
    include: {
      track: { include: { campaignTracks: { where: { campaignId: campaign.id } } } },
      currentRevision: { include: { assets: { orderBy: { sortOrder: 'asc' } } } },
      // 历史版本也要带上素材数量，否则「提交历史」里每一版都显示 0 张
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        include: { _count: { select: { assets: true } } },
      },
    },
  })

  if (!entry) throw notFound('打卡记录不存在')
  // 参赛者只能看自己的记录（design.md §13）
  if (entry.participantId !== participant.id) {
    throw new AppError('NOT_ENTRY_OWNER', '只能查看自己的打卡记录')
  }
  void now

  const campaignTrack = entry.track.campaignTracks[0]

  return {
    entry_id: entry.id,
    track: {
      slug: entry.track.slug,
      name: entry.track.name,
      proof_instructions: campaignTrack?.proofInstructions ?? entry.track.proofInstructions,
    },
    activity_date: entry.activityDate,
    status: entry.status as EntryStatus,
    version: entry.version,
    submitted_at: entry.currentSubmittedAt.toISOString(),
    reviewed_at: entry.reviewedAt?.toISOString() ?? null,
    rejection_reason: entry.rejectionReason,
    rejection_code: entry.rejectionCode,
    reopen_expires_at: entry.reopenExpiresAt?.toISOString() ?? null,
    current_revision: entry.currentRevision
      ? {
          revision_number: entry.currentRevision.revisionNumber,
          note: entry.currentRevision.note,
          submitted_at: entry.currentRevision.submittedAt.toISOString(),
          assets: entry.currentRevision.assets.map((asset) => ({
            asset_id: asset.id,
            width: asset.width,
            height: asset.height,
            mime_type: asset.mimeType,
            size: asset.size,
          })),
        }
      : null,
    history: entry.revisions
      .filter((revision) => revision.id !== entry.currentRevisionId)
      .map((revision) => ({
        revision_number: revision.revisionNumber,
        note: revision.note,
        submitted_at: revision.submittedAt.toISOString(),
        asset_count: revision._count.assets,
      })),
  }
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------

export interface SubmitResult {
  entry_id: string
  activity_date: string
  track: { slug: string; name: string }
  status: EntryStatus
  revision_number: number
  version: number
  submitted_at: string
  asset_count: number
  /** 命中幂等键时为 true —— 本次没有产生新版本 */
  idempotent_replay: boolean
}

function assertFilesWithinRules(
  files: readonly UploadedFile[],
  rules: { minImages: number; maxImages: number; maxImageBytes: number },
): void {
  if (files.length < rules.minImages) {
    throw new AppError('UPLOAD_INVALID', `至少需要上传 ${rules.minImages} 张图片`)
  }
  if (files.length > rules.maxImages) {
    throw new AppError('UPLOAD_INVALID', `最多只能上传 ${rules.maxImages} 张图片`)
  }
  for (const file of files) {
    if (file.size > rules.maxImageBytes) {
      const limitMb = (rules.maxImageBytes / 1024 / 1024).toFixed(1)
      throw new AppError('UPLOAD_INVALID', `单张图片不能超过 ${limitMb} MB`)
    }
  }
}

export async function submitCheckin(params: {
  principal: AuthPrincipal
  fields: SubmitCheckinFields
  files: readonly UploadedFile[]
  now?: Date
}): Promise<SubmitResult> {
  const { principal, fields, files } = params
  const now = params.now ?? new Date()
  const prisma = getPrismaClient()

  const campaign = await requireCurrentCampaign(prisma)

  // ---- 活动是否接受提交 ----
  if (!SUBMITTABLE_CAMPAIGN_STATUSES.includes(campaign.status as never)) {
    throw new AppError('CAMPAIGN_NOT_ACTIVE', '当前活动不在打卡进行中')
  }

  const participant = await resolveParticipant(campaign.id, principal.userId, prisma)
  if (!participant) throw new AppError('FORBIDDEN', '当前账号不是该活动的参赛者')
  if (participant.status !== 'active') throw new AppError('FORBIDDEN', '参赛账号已被停用')

  const campaignTrack = campaign.campaignTracks.find(
    (item) => item.track.slug === fields.track || item.trackId === fields.track,
  )
  if (!campaignTrack) throw notFound('该赛道未在此活动中启用')
  if (!campaignTrack.enabled) throw new AppError('TRACK_DISABLED', '该赛道当前未开放打卡')

  const activityDate = fields.activity_date
  const today = toActivityDate(now)
  if (activityDate > today) {
    throw new AppError('VALIDATION_FAILED', '不能提交未来日期的打卡')
  }

  const existing = await prisma.checkinEntry.findUnique({
    where: {
      participantId_trackId_activityDate: {
        participantId: participant.id,
        trackId: campaignTrack.trackId,
        activityDate,
      },
    },
    include: { currentRevision: { select: { id: true, revisionNumber: true, clientToken: true } } },
  })

  // ---- 幂等：同一 client_token 重复提交直接返回既有版本（§7.4 防重复点击）----
  if (existing && fields.client_token) {
    const replayed = await prisma.submissionRevision.findUnique({
      where: { entryId_clientToken: { entryId: existing.id, clientToken: fields.client_token } },
      select: { revisionNumber: true, submittedAt: true, _count: { select: { assets: true } } },
    })
    if (replayed) {
      return {
        entry_id: existing.id,
        activity_date: existing.activityDate,
        track: { slug: campaignTrack.track.slug, name: campaignTrack.track.name },
        status: existing.status as EntryStatus,
        revision_number: replayed.revisionNumber,
        version: existing.version,
        submitted_at: replayed.submittedAt.toISOString(),
        asset_count: replayed._count.assets,
        idempotent_replay: true,
      }
    }
  }

  // ---- 提交时间窗 ----
  // 管理员临时重新开放时，槽位带 reopenExpiresAt，在时限内放宽截止校验（§8.5）
  const reopenExpiresAt = existing?.reopenExpiresAt ?? null
  if (
    !isSubmissionAllowed({
      activityDate,
      dailyOpenTime: campaign.dailyOpenTime,
      dailyDeadline: campaign.dailyDeadline,
      now,
      reopenExpiresAt,
    })
  ) {
    const state = windowState(activityDate, campaign.dailyOpenTime, campaign.dailyDeadline, now)
    throw new AppError(
      state === 'before_open' ? 'CHECKIN_NOT_OPEN' : 'CHECKIN_CLOSED',
      state === 'before_open' ? '今日打卡尚未开放' : '该活动日的打卡已经截止',
    )
  }

  // ---- 已通过的记录参赛者不能自行修改 ----
  if (existing && existing.status === 'approved') {
    throw new AppError('CHECKIN_ALREADY_APPROVED', '该记录已审核通过，如需修改请联系管理员重新打开')
  }
  if (existing && (existing.status === 'void' || existing.status === 'revoked')) {
    throw new AppError('STATE_TRANSITION_INVALID', '该记录已被管理员处置，无法重新提交')
  }

  assertFilesWithinRules(files, {
    minImages: campaign.minImages,
    maxImages: campaign.maxImages,
    maxImageBytes: campaign.maxImageBytes,
  })

  // ---- 图片流水线：解码校验 → 剥离 EXIF → 计算摘要 ----
  const allowedMimeTypes = JSON.parse(campaign.allowedMimeTypes) as string[]
  const processed = []
  for (const file of files) {
    processed.push(await processImage(file.buffer, allowedMimeTypes))
  }

  // 先落存储再写库：万一事务失败最多留下孤儿对象，
  // 由 cleanup_orphan_uploads 任务在宽限期后回收，不会出现「有记录无文件」
  const storage = getStorage()
  const stored: Array<ProcessedImage & { objectKey: string }> = []
  for (const image of processed) {
    const objectKey = randomObjectKey()
    await storage.put(objectKey, image.buffer)
    stored.push({ objectKey, ...image })
  }

  const result = await runInTransaction(prisma, async (tx) => {
    // 事务内重新读取，避免并发请求各自基于过期快照写入
    const entry = await tx.checkinEntry.findUnique({
      where: {
        participantId_trackId_activityDate: {
          participantId: participant.id,
          trackId: campaignTrack.trackId,
          activityDate,
        },
      },
      include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
    })

    if (entry && entry.status === 'approved') {
      throw new AppError('CHECKIN_ALREADY_APPROVED', '该记录在此期间已被审核通过，请刷新后查看')
    }

    const nextRevisionNumber = (entry?.revisions[0]?.revisionNumber ?? 0) + 1

    const targetEntry =
      entry ??
      (await tx.checkinEntry.create({
        data: {
          campaignId: campaign.id,
          participantId: participant.id,
          trackId: campaignTrack.trackId,
          activityDate,
          status: 'pending',
          currentSubmittedAt: now,
        },
      }))

    const revision = await tx.submissionRevision.create({
      data: {
        entryId: targetEntry.id,
        revisionNumber: nextRevisionNumber,
        note: fields.note,
        submittedAt: now,
        submittedBy: principal.userId,
        clientToken: fields.client_token,
        assets: {
          create: stored.map((image, index) => ({
            objectKey: image.objectKey,
            mimeType: image.mimeType,
            size: image.size,
            width: image.width,
            height: image.height,
            sha256: image.sha256,
            sortOrder: index,
          })),
        },
      },
    })

    // 重新提交把状态恢复为 pending 并清空上一次的驳回信息（§6.4）
    const updated = await tx.checkinEntry.update({
      where: { id: targetEntry.id },
      data: {
        currentRevisionId: revision.id,
        currentSubmittedAt: now,
        status: 'pending',
        version: { increment: 1 },
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        rejectionCode: null,
        // 重开时限用掉即清空，避免长期生效
        reopenExpiresAt: null,
      },
    })

    return { entry: updated, revisionNumber: revision.revisionNumber }
  })

  return {
    entry_id: result.entry.id,
    activity_date: activityDate,
    track: { slug: campaignTrack.track.slug, name: campaignTrack.track.name },
    status: 'pending',
    revision_number: result.revisionNumber,
    version: result.entry.version,
    submitted_at: now.toISOString(),
    asset_count: stored.length,
    idempotent_replay: false,
  }
}
