import { z } from 'zod'
import {
  CAMPAIGN_STATUSES,
  NAME_DISPLAY_MODES,
  SUPPORTED_TIMEZONES,
  TIE_BREAK_RULES,
} from '../../config/constants.js'
import { dateOnlySchema, idSchema, timeOfDaySchema } from '../../core/validation.js'

/**
 * 分值以整数毫点表示（1000 = 1 分），权重为整数千分比。
 * 用整数而非小数是刻意的：浮点累加会产生不可复现的尾差，
 * 让「同分并列」的判定在不同次计算之间抖动。
 */
const milliPointsSchema = z.coerce.number().int().min(-1_000_000).max(1_000_000)

const trackConfigSchema = z.object({
  track_id: idSchema,
  enabled: z.boolean().optional(),
  daily_points: milliPointsSchema.optional(),
  daily_cap: milliPointsSchema.nullable().optional(),
  campaign_cap: milliPointsSchema.nullable().optional(),
  overall_weight: z.coerce.number().int().min(0).max(100_000).optional(),
  proof_instructions: z.string().max(2000).nullable().optional(),
})

export const createCampaignBodySchema = z
  .object({
    name: z.string().trim().min(1, '请填写活动名称').max(120),
    description: z.string().max(4000).nullable().optional(),
    timezone: z.enum(SUPPORTED_TIMEZONES).default('Asia/Shanghai'),
    start_date: dateOnlySchema,
    end_date: dateOnlySchema,
    daily_open_time: timeOfDaySchema.default('00:00'),
    daily_deadline: timeOfDaySchema.default('23:59'),
    leaderboard_visible: z.boolean().default(false),
    leaderboard_time: timeOfDaySchema.default('06:00'),
    name_display_mode: z.enum(NAME_DISPLAY_MODES).default('real'),
    min_images: z.coerce.number().int().min(0).max(9).default(1),
    max_images: z.coerce.number().int().min(1).max(9).default(3),
    max_image_bytes: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
    allowed_mime_types: z.array(z.enum(['image/jpeg', 'image/png', 'image/webp'])).min(1).default(['image/jpeg', 'image/png', 'image/webp']),
    tracks: z.array(trackConfigSchema).optional(),
  })
  .refine((value) => value.start_date <= value.end_date, {
    message: '结束日期不能早于开始日期',
    path: ['end_date'],
  })
  .refine((value) => value.min_images <= value.max_images, {
    message: '最少图片数不能大于最多图片数',
    path: ['min_images'],
  })

export const updateCampaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(4000).nullable().optional(),
    start_date: dateOnlySchema.optional(),
    end_date: dateOnlySchema.optional(),
    daily_open_time: timeOfDaySchema.optional(),
    daily_deadline: timeOfDaySchema.optional(),
    status: z.enum(CAMPAIGN_STATUSES).optional(),
    leaderboard_visible: z.boolean().optional(),
    leaderboard_time: timeOfDaySchema.optional(),
    name_display_mode: z.enum(NAME_DISPLAY_MODES).optional(),
    tie_break_rule: z.enum(TIE_BREAK_RULES).optional(),
    min_images: z.coerce.number().int().min(0).max(9).optional(),
    max_images: z.coerce.number().int().min(1).max(9).optional(),
    max_image_bytes: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).optional(),
    allowed_mime_types: z
      .array(z.enum(['image/jpeg', 'image/png', 'image/webp']))
      .min(1)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export const updateCampaignTrackBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    daily_points: milliPointsSchema.optional(),
    daily_cap: milliPointsSchema.nullable().optional(),
    campaign_cap: milliPointsSchema.nullable().optional(),
    overall_weight: z.coerce.number().int().min(0).max(100_000).optional(),
    proof_instructions: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export const campaignTrackParamsSchema = z.object({
  trackId: idSchema,
})

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>
export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>
export type UpdateCampaignTrackBody = z.infer<typeof updateCampaignTrackBodySchema>
