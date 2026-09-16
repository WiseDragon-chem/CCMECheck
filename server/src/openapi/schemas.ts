import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import {
  CAMPAIGN_STATUSES,
  ERROR_CODE_VALUES,
  ENTRY_STATUSES,
  PARTICIPANT_STATUSES,
  REJECT_REASON_CODE_VALUES,
  USER_ROLES,
  USER_STATUSES,
} from '../config/constants.js'

/**
 * OpenAPI 组件 schema。
 *
 * 这里的定义是**响应体的契约**，与 service 层实际返回的形状一一对应。
 * 请求体的校验规则不在这里重复 —— 各模块的 schema.ts 才是唯一来源，
 * 路由注册时直接引用它们，避免出现「文档与校验不一致」。
 */
extendZodWithOpenApi(z)

/**
 * design.md §12.5 规定的统一错误响应体。
 *
 * code 用枚举而不是 string：错误码目录本就该是契约的一部分。
 * 前端据此能拿到编译器强制的穷尽性检查 —— 服务端新增一个错误码
 * 而前端没有对应处理时，它的错误映射表会直接编译不过。
 */
export const ErrorResponseSchema = z
  .object({
    code: z.enum(ERROR_CODE_VALUES).openapi({ example: 'CHECKIN_CLOSED' }),
    message: z.string().openapi({ example: '该活动日的打卡已经截止' }),
    request_id: z.string().openapi({ example: 'req_5f3a9c1d7b6e4a52' }),
    details: z.record(z.string(), z.unknown()),
  })
  .openapi('ErrorResponse')

export const UserSchema = z
  .object({
    id: z.string(),
    student_id: z.string(),
    name: z.string(),
    role: z.enum(USER_ROLES),
    status: z.enum(USER_STATUSES),
    capabilities: z.array(z.string()),
  })
  .openapi('User')

export const AuthResponseSchema = z
  .object({
    user: UserSchema,
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().openapi({ description: '访问令牌有效期（秒）' }),
  })
  .openapi('AuthResponse')

export const TrackSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    proof_instructions: z.string().nullable(),
    enabled: z.boolean(),
    daily_points: z.number().int().openapi({ description: '毫点，1000 = 1 分' }),
    daily_cap: z.number().int().nullable(),
    campaign_cap: z.number().int().nullable(),
    overall_weight: z.number().int().openapi({ description: '千分比，1000 = 1.0' }),
  })
  .openapi('Track')

export const CampaignSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    timezone: z.string(),
    start_date: z.string().openapi({ example: '2026-10-01' }),
    end_date: z.string(),
    daily_open_time: z.string().openapi({ example: '00:00' }),
    daily_deadline: z.string().openapi({ example: '23:59' }),
    status: z.enum(CAMPAIGN_STATUSES),
    leaderboard_visible: z.boolean(),
    leaderboard_time: z.string(),
    name_display_mode: z.string(),
    tie_break_rule: z.string(),
    upload_rules: z.object({
      min_images: z.number().int(),
      max_images: z.number().int(),
      max_image_bytes: z.number().int(),
      allowed_mime_types: z.array(z.string()),
    }),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Campaign')

export const CampaignCurrentResponseSchema = z
  .object({
    campaign: CampaignSchema,
    tracks: z.array(TrackSchema),
    server_time: z.string().openapi({ description: '服务器 UTC 时间；倒计时只作提示，判定以服务器为准' }),
    activity_date: z.string().openapi({ description: '当前活动日（北京时间）' }),
    server_time_of_day: z.string().openapi({ example: '21:25' }),
  })
  .openapi('CampaignCurrentResponse')

export const TodayCardSchema = z
  .object({
    track_id: z.string(),
    slug: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    proof_instructions: z.string().nullable(),
    card_state: z
      .enum(['before_open', 'can_submit', 'pending', 'approved', 'rejected', 'missed', 'invalid'])
      .openapi({ description: 'design.md §7.3 的卡片状态；invalid 对应被撤销或作废的记录' }),
    can_submit: z.boolean(),
    entry_id: z.string().nullable(),
    status: z.enum(ENTRY_STATUSES).nullable(),
    rejection_reason: z.string().nullable(),
    rejection_code: z.string().nullable(),
    submitted_at: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    /** 该槽位被管理员临时重新开放到什么时候；null 表示没有重开 */
    reopen_expires_at: z.string().nullable(),
    valid_days: z.number().int(),
    track_score: z.number().int().openapi({ description: '毫点' }),
    daily_points: z.number().int(),
    daily_cap: z.number().int().nullable(),
    campaign_cap: z.number().int().nullable(),
    overall_weight: z.number().int(),
  })
  .openapi('TodayCard')

export const TodayOverviewSchema = z
  .object({
    is_participant: z.boolean().openapi({ description: '审核员与超管可能不是参赛者，此时 cards 为空数组' }),
    participant_id: z.string().nullable(),
    campaign: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      start_date: z.string(),
      end_date: z.string(),
      daily_open_time: z.string(),
      daily_deadline: z.string(),
    }),
    activity_date: z.string(),
    server_time: z.string(),
    seconds_to_deadline: z.number().int().nullable(),
    total_valid_days: z.number().int(),
    total_score: z.number().int().openapi({ description: '毫点' }),
    cards: z.array(TodayCardSchema),
  })
  .openapi('TodayOverview')

export const CheckinListItemSchema = z
  .object({
    entry_id: z.string(),
    track: z.object({ slug: z.string(), name: z.string() }),
    activity_date: z.string(),
    status: z.enum(ENTRY_STATUSES),
    version: z.number().int(),
    submitted_at: z.string(),
    reviewed_at: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    rejection_code: z.string().nullable(),
    note: z.string().nullable(),
    asset_count: z.number().int(),
    can_resubmit: z.boolean(),
  })
  .openapi('CheckinListItem')

export const CheckinListResponseSchema = z
  .object({
    items: z.array(CheckinListItemSchema),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  })
  .openapi('CheckinListResponse')

export const CheckinDetailSchema = z
  .object({
    entry_id: z.string(),
    track: z.object({ slug: z.string(), name: z.string(), proof_instructions: z.string().nullable() }),
    activity_date: z.string(),
    status: z.enum(ENTRY_STATUSES),
    version: z.number().int(),
    submitted_at: z.string(),
    reviewed_at: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    rejection_code: z.string().nullable(),
    reopen_expires_at: z.string().nullable(),
    current_revision: z
      .object({
        revision_number: z.number().int(),
        note: z.string().nullable(),
        submitted_at: z.string(),
        assets: z.array(
          z.object({
            asset_id: z.string(),
            width: z.number().int().nullable(),
            height: z.number().int().nullable(),
            mime_type: z.string(),
            size: z.number().int(),
          }),
        ),
      })
      .nullable(),
    history: z.array(
      z.object({
        revision_number: z.number().int(),
        note: z.string().nullable(),
        submitted_at: z.string(),
        asset_count: z.number().int(),
      }),
    ),
  })
  .openapi('CheckinDetail')

export const SubmitCheckinResponseSchema = z
  .object({
    entry_id: z.string(),
    activity_date: z.string(),
    track: z.object({ slug: z.string(), name: z.string() }),
    status: z.enum(ENTRY_STATUSES),
    revision_number: z.number().int(),
    version: z.number().int(),
    submitted_at: z.string(),
    asset_count: z.number().int(),
    idempotent_replay: z.boolean().openapi({ description: 'true 表示命中幂等键，本次未产生新版本' }),
  })
  .openapi('SubmitCheckinResponse')

export const SignedAssetUrlSchema = z
  .object({
    url: z.string().openapi({ description: '短期有效的图片地址，可直接用于 <img src>' }),
    expires_at: z.string(),
    expires_in: z.number().int().openapi({ description: '有效期（秒）' }),
  })
  .openapi('SignedAssetUrl')

export const LeaderboardRowSchema = z
  .object({
    rank: z.number().int(),
    participant_id: z.string(),
    name: z.string().openapi({ description: '可能已按活动配置脱敏' }),
    class_name: z.string().nullable(),
    valid_days: z.number().int(),
    score: z.number().openapi({ description: '展示分值，保留三位小数' }),
    score_milli: z.number().int().openapi({ description: '精确值（毫点）' }),
    reached_at: z.string().nullable(),
    is_me: z.boolean(),
  })
  .openapi('LeaderboardRow')

export const LeaderboardResponseSchema = z
  .object({
    snapshot: z
      .object({
        id: z.string(),
        cutoff_date: z.string(),
        generated_at: z.string(),
        is_final: z.boolean(),
        status: z.string(),
      })
      .nullable(),
    track: z.object({ slug: z.string(), name: z.string() }),
    counted_through: z.string().nullable().openapi({ description: '已统计到的活动日期' }),
    rows: z.array(LeaderboardRowSchema),
    total: z.number().int(),
    me: z
      .object({ row: LeaderboardRowSchema, window: z.array(LeaderboardRowSchema) })
      .nullable(),
  })
  .openapi('LeaderboardResponse')

export const ParticipantSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    student_id: z.string(),
    name: z.string(),
    class_name: z.string().nullable(),
    status: z.enum(PARTICIPANT_STATUSES),
    account_status: z.enum(USER_STATUSES),
    joined_at: z.string(),
  })
  .openapi('Participant')

export const ReviewQueueEntrySchema = z
  .object({
    entry_id: z.string(),
    participant: z.object({ student_id: z.string(), name: z.string(), class_name: z.string().nullable() }),
    track: z.object({ slug: z.string(), name: z.string() }),
    activity_date: z.string(),
    submitted_at: z.string(),
    revision_number: z.number().int(),
    asset_count: z.number().int(),
    version: z.number().int().openapi({ description: '乐观并发令牌，审核请求必须原样回传' }),
    is_resubmission: z.boolean(),
  })
  .openapi('ReviewQueueEntry')

export const RejectReasonSchema = z
  .object({
    code: z.enum(REJECT_REASON_CODE_VALUES),
    label: z.string(),
  })
  .openapi('RejectReason')

export const AuditLogEntrySchema = z
  .object({
    id: z.string(),
    actor: z
      .object({ id: z.string(), student_id: z.string(), name: z.string(), role: z.enum(USER_ROLES) })
      .nullable(),
    action: z.string().openapi({ example: 'review.approve' }),
    target_type: z.string().nullable(),
    target_id: z.string().nullable(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    request_id: z.string().nullable(),
    ip: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AuditLogEntry')

export const JobRunSchema = z
  .object({
    id: z.string(),
    job_name: z.string(),
    status: z.enum(['running', 'success', 'failed', 'skipped_locked']),
    trigger: z.enum(['cron', 'manual']),
    triggered_by: z.object({ student_id: z.string(), name: z.string() }).nullable(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    processed_count: z.number().int(),
    error_summary: z.string().nullable(),
  })
  .openapi('JobRun')

/** registerPath 里反复用到的标准错误响应集合 */
export function errorResponses(...codes: Array<400 | 401 | 403 | 404 | 409 | 429>) {
  const description: Record<number, string> = {
    400: '请求参数校验未通过',
    401: '未认证或令牌失效',
    403: '权限不足',
    404: '资源不存在',
    409: '与当前状态冲突',
    429: '请求过于频繁',
  }

  const result: Record<number, { description: string; content: Record<string, unknown> }> = {}
  for (const code of codes) {
    result[code] = {
      description: description[code]!,
      content: { 'application/json': { schema: ErrorResponseSchema } },
    }
  }
  return result
}
