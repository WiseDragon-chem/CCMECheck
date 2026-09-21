import {
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGES,
  DEFAULT_MIN_IMAGES,
  type CampaignStatus,
} from '../../config/constants.js'
import { AppError } from '../../core/errors.js'
import { cstToday, toActivityDate } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'

export function parseMimeList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export interface PublicTrack {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  proof_instructions: string | null
  enabled: boolean
  daily_points: number
  /** null 表示不限 */
  daily_cap: number | null
  /** null 表示不限 */
  campaign_cap: number | null
  overall_weight: number
}

export interface PublicCampaign {
  id: string
  name: string
  description: string | null
  timezone: string
  start_date: string
  end_date: string
  daily_open_time: string
  daily_deadline: string
  status: CampaignStatus
  leaderboard_visible: boolean
  leaderboard_time: string
  name_display_mode: string
  tie_break_rule: string
  upload_rules: {
    min_images: number
    max_images: number
    max_image_bytes: number
    allowed_mime_types: string[]
  }
  created_at: string
  updated_at: string
}

type CampaignRecord = Awaited<ReturnType<typeof findCampaignWithTracks>>

function findCampaignWithTracks(db: Db, campaignId: string) {
  return db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      campaignTracks: {
        include: { track: true },
        orderBy: { track: { sortOrder: 'asc' } },
      },
    },
  })
}

export interface UploadRules {
  minImages: number
  maxImages: number
  maxImageBytes: number
  allowedMimeTypes: string[]
}

/**
 * 上传限制的唯一事实来源。
 *
 * 对外的 `upload_rules` 与上传前的预算闸（middleware/upload.ts）都从这里取值 ——
 * 两处各算一遍的话，「页面上写的限额」和「后端真正拦的限额」迟早会分家。
 */
export function toUploadRules(campaign: NonNullable<CampaignRecord>): UploadRules {
  const allowed = parseMimeList(campaign.allowedMimeTypes)
  return {
    minImages: campaign.minImages ?? DEFAULT_MIN_IMAGES,
    maxImages: campaign.maxImages ?? DEFAULT_MAX_IMAGES,
    maxImageBytes: campaign.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    allowedMimeTypes: allowed.length > 0 ? allowed : [...DEFAULT_ALLOWED_MIME_TYPES],
  }
}

export function toPublicCampaign(campaign: NonNullable<CampaignRecord>): PublicCampaign {
  const rules = toUploadRules(campaign)
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    timezone: campaign.timezone,
    start_date: campaign.startDate,
    end_date: campaign.endDate,
    daily_open_time: campaign.dailyOpenTime,
    daily_deadline: campaign.dailyDeadline,
    status: campaign.status as CampaignStatus,
    leaderboard_visible: campaign.leaderboardVisible,
    leaderboard_time: campaign.leaderboardTime,
    name_display_mode: campaign.nameDisplayMode,
    tie_break_rule: campaign.tieBreakRule,
    upload_rules: {
      min_images: rules.minImages,
      max_images: rules.maxImages,
      max_image_bytes: rules.maxImageBytes,
      allowed_mime_types: rules.allowedMimeTypes,
    },
    created_at: campaign.createdAt.toISOString(),
    updated_at: campaign.updatedAt.toISOString(),
  }
}

export function toPublicTrack(
  campaignTrack: NonNullable<CampaignRecord>['campaignTracks'][number],
): PublicTrack {
  return {
    id: campaignTrack.track.id,
    slug: campaignTrack.track.slug,
    name: campaignTrack.track.name,
    description: campaignTrack.track.description,
    icon: campaignTrack.track.icon,
    // 活动级说明优先，未配置时回落到赛道默认说明
    proof_instructions: campaignTrack.proofInstructions ?? campaignTrack.track.proofInstructions,
    enabled: campaignTrack.enabled,
    daily_points: campaignTrack.dailyPoints,
    daily_cap: campaignTrack.dailyCap,
    campaign_cap: campaignTrack.campaignCap,
    overall_weight: campaignTrack.overallWeight,
  }
}

/**
 * 解析「当前活动」。
 *
 * 单次院内活动的部署形态下，同一时间只应有一个处于 active/settling 的活动。
 * 优先级：进行中 > 待开始 > 其他未归档中最近创建的。
 */
export async function resolveCurrentCampaign(db: Db = getPrismaClient()) {
  const live = await db.campaign.findFirst({
    where: { status: { in: ['active', 'settling'] } },
    orderBy: { startDate: 'desc' },
  })
  if (live) return live

  const published = await db.campaign.findFirst({
    where: { status: 'published' },
    orderBy: { startDate: 'desc' },
  })
  if (published) return published

  return db.campaign.findFirst({
    where: { status: { notIn: ['archived'] } },
    orderBy: { startDate: 'desc' },
  })
}

/**
 * 当前活动的上传预算，供中间件在读取请求体**之前**预检。
 *
 * 刻意不用 requireCurrentCampaign：那会连赛道一起查（守卫用不到），
 * 也会在没有活动时抛 409 —— 而「此刻能不能提交」是 submitCheckin 的判断，
 * 守卫只需要一份最宽的预算：没有活动时回落到默认限制，让请求继续走到业务层去拿准确错误。
 *
 * 不做缓存：管理员随时可能下调限额，缓存旧值会让超限请求继续被放行。
 */
export async function currentUploadBudget(
  db: Db = getPrismaClient(),
): Promise<{ maxImages: number; maxImageBytes: number }> {
  const campaign = await resolveCurrentCampaign(db)
  if (!campaign) {
    return { maxImages: DEFAULT_MAX_IMAGES, maxImageBytes: DEFAULT_MAX_IMAGE_BYTES }
  }
  return { maxImages: campaign.maxImages, maxImageBytes: campaign.maxImageBytes }
}

/** 取当前活动并附带赛道配置；没有活动时抛出可读错误 */
export async function requireCurrentCampaign(db: Db = getPrismaClient()) {
  const current = await resolveCurrentCampaign(db)
  if (!current) {
    throw new AppError('CAMPAIGN_NOT_ACTIVE', '当前没有进行中的活动')
  }
  const full = await findCampaignWithTracks(db, current.id)
  if (!full) throw new AppError('CAMPAIGN_NOT_ACTIVE', '当前没有进行中的活动')
  return full
}

export async function getCampaignWithTracks(campaignId: string, db: Db = getPrismaClient()) {
  const campaign = await findCampaignWithTracks(db, campaignId)
  if (!campaign) throw new AppError('NOT_FOUND', '活动不存在')
  return campaign
}

/**
 * 依据日期推导活动状态（design.md §14 的「活动状态边界自动切换」）。
 *
 * 设计文档只给了这条需求，没有状态迁移表，这里按最保守的规则实现：
 *   published → active   当北京时间今天 >= 开始日期
 *   active    → settling 当北京时间今天 > 结束日期（最后一次截止已过）
 * draft / finished / archived 一律手工流转，不自动迁移。
 */
export function computeAutoStatus(
  campaign: { status: string; startDate: string; endDate: string },
  now: Date = new Date(),
): CampaignStatus | null {
  const today = cstToday(now)

  if (campaign.status === 'published' && today >= campaign.startDate) return 'active'
  if (campaign.status === 'active' && today > campaign.endDate) return 'settling'
  return null
}

export { toActivityDate }
