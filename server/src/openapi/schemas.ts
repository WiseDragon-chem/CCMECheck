import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import {
  CAMPAIGN_STATUSES,
  ERROR_CODE_VALUES,
  ENTRY_STATUSES,
  JOB_NAMES,
  JOB_RUN_STATUSES,
  PARTICIPANT_STATUSES,
  REJECT_REASON_CODE_VALUES,
  REVIEW_ACTIONS,
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
    // id 供前端直接跳转到名单页/筛选该参赛者的其他记录，不必再按学号反查
    participant: z.object({
      id: z.string(),
      student_id: z.string(),
      name: z.string(),
      class_name: z.string().nullable(),
    }),
    track: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
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

// ---------------------------------------------------------------------------
// 管理后台：分页、参赛者
// ---------------------------------------------------------------------------

/**
 * 管理后台各列表接口共用的分页字段。
 *
 * 名单、审核队列、审计日志、任务历史四处返回的都是这一组字段，前端也共用同一个
 * 分页控件。抽成组件而不是逐处重写：将来要对齐字段命名时只改一行，
 * 也不会出现「某个接口忘了返回 page」这种只有翻到那一页才发现的问题。
 */
export const PaginationFieldsSchema = z
  .object({
    total: z.number().int().openapi({ description: '满足筛选条件的总条数，与当前页无关' }),
    page: z.number().int(),
    page_size: z.number().int(),
  })
  .openapi('PaginationFields')

/**
 * 管理后台看到的参赛者。
 *
 * 在 Participant 之上补三个只有管理员需要、也只能由管理员看到的字段。
 * activated 与 account_status 的区别值得说明：它表达的是「有没有设置过密码」，
 * 而被禁用的账号 account_status 已是 disabled 但 activated 仍为 true ——
 * 名单页要据此把「还没激活」和「激活后被禁用」分成两种处理方式（前者重发激活码，
 * 后者解除禁用即可），只看 account_status 是分不出来的。
 */
export const AdminParticipantSchema = ParticipantSchema.extend({
  phone_suffix: z.string().nullable(),
  remark: z.string().nullable(),
  activated: z.boolean(),
}).openapi('AdminParticipant')

export const AdminParticipantListResponseSchema = PaginationFieldsSchema.extend({
  items: z.array(AdminParticipantSchema).openapi({ description: '按学号升序，便于与纸质名单核对' }),
}).openapi('AdminParticipantListResponse')

// ---------------------------------------------------------------------------
// 管理后台：活动配置
// ---------------------------------------------------------------------------

/**
 * 管理端的活动配置视图：当前活动 + 它的赛道规则。
 *
 * 刻意不复用参赛者侧的 CampaignCurrentResponse —— 那个还带 server_time、
 * activity_date 等只对打卡倒计时有意义的字段，管理端并不返回它们。
 * 用一个独立的组件，前端在管理页上就不会去读一批永远为 undefined 的字段。
 */
export const CampaignConfigResponseSchema = z
  .object({
    campaign: CampaignSchema,
    tracks: z.array(TrackSchema),
  })
  .openapi('CampaignConfigResponse')

/**
 * 活动配置更新结果。
 *
 * actor 是执行者的用户 id：§8.4 要求高风险改动可追溯到人，
 * 前端据此在成功提示里带上「由谁改的」，而不必再查一次审计日志。
 */
export const CampaignUpdateResponseSchema = CampaignConfigResponseSchema.extend({
  impact_warning: z.string().nullable().openapi({
    description: '活动已开始却改动了计分字段时的风险提示；null 表示本次改动无影响',
  }),
  actor: z.string(),
}).openapi('CampaignUpdateResponse')

export const CampaignTrackUpdateResponseSchema = z
  .object({
    // 传 null 只可能发生在活动被并发换掉的极端情况，前端仍需按可空处理
    track: TrackSchema.nullable(),
    impact_warning: z.string().nullable(),
  })
  .openapi('CampaignTrackUpdateResponse')

// ---------------------------------------------------------------------------
// 管理后台：参赛者维护
// ---------------------------------------------------------------------------

/**
 * 新建参赛者与重新生成激活码共用同一个响应体。
 *
 * 两个接口返回的都是「更新后的参赛者 + 一个只出现一次的明文激活码」，
 * 合成一个组件是为了让前端只需写一份「弹出激活码并提示立即转交」的逻辑。
 */
export const ParticipantActivationResponseSchema = z
  .object({
    participant: AdminParticipantSchema,
    activation_code: z.string().openapi({ description: '明文只在此响应中出现一次，库里只保存哈希' }),
  })
  .openapi('ParticipantActivationResponse')

export const ParticipantStatusUpdateResponseSchema = z
  .object({
    participant: AdminParticipantSchema,
    revoked_sessions: z.number().int().openapi({ description: '被一并撤销的登录会话数' }),
  })
  .openapi('ParticipantStatusUpdateResponse')

export const ParticipantPasswordResetResponseSchema = z
  .object({
    participant: AdminParticipantSchema,
    password: z.string().openapi({ description: '一次性初始密码，只在此响应中出现一次' }),
  })
  .openapi('ParticipantPasswordResetResponse')

/**
 * 匿名化结果。
 *
 * 保留 participant 是为了让名单页就地更新那一行 —— 匿名化之后姓名、班级、
 * 学号快照都已变成占位值或被清空，前端不该沿用本地缓存的旧值。
 */
export const AnonymizeParticipantResponseSchema = z
  .object({
    participant: AdminParticipantSchema,
    deleted_assets: z.number().int().openapi({ description: '被删除的证明材料数量；保留证据时为 0' }),
    revoked_sessions: z.number().int(),
  })
  .openapi('AnonymizeParticipantResponse')

// ---------------------------------------------------------------------------
// 管理后台：名单导入
// ---------------------------------------------------------------------------

/** 校验汇总。预览与正式导入用的是同一次计算的结论，因此共享一个组件 */
export const ImportSummarySchema = z
  .object({
    total: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    existing_users: z.number().int().openapi({ description: '学号已存在、提交时会走更新的行数' }),
    duplicates_in_file: z.number().int().openapi({ description: '同一文件内重复出现（第二次及以后）的行数' }),
  })
  .openapi('ImportSummary')

/** 预览的单行结论；status 为 error 时 errors 逐条给出原因 */
export const ImportPreviewRowSchema = z
  .object({
    line: z.number().int().openapi({ description: '原始 CSV 中的行号，便于管理员直接定位到那一行' }),
    student_id: z.string(),
    name: z.string(),
    class_name: z.string().nullable(),
    status: z.enum(['ok', 'error']),
    errors: z.array(z.string()),
    existing: z.boolean().openapi({ description: 'true 表示该学号已有账号，提交后是更新而不是新建' }),
  })
  .openapi('ImportPreviewRow')

export const ImportPreviewResponseSchema = z
  .object({
    batch_id: z.string().openapi({ description: '正式导入时必须原样回传的批次标识' }),
    summary: ImportSummarySchema,
    rows: z.array(ImportPreviewRowSchema),
    rows_truncated: z
      .boolean()
      .openapi({ description: 'true 表示 rows 被截断，summary 仍是精确值' }),
  })
  .openapi('ImportPreviewResponse')

export const ImportCommitResponseSchema = z
  .object({
    batch_id: z.string(),
    created: z.number().int().openapi({ description: '新建的账号数' }),
    updated: z.number().int().openapi({ description: '已存在因而走更新的行数' }),
    skipped: z.number().int().openapi({ description: '校验未通过因而没有写入的行数' }),
    activation_codes: z
      .array(
        z.object({
          student_id: z.string(),
          name: z.string(),
          activation_code: z.string(),
        }),
      )
      .openapi({ description: '只为新建账号发放；明文只出现一次，之后无法再导出（库里只有哈希）' }),
  })
  .openapi('ImportCommitResponse')

// ---------------------------------------------------------------------------
// 审核
// ---------------------------------------------------------------------------

/** 审核进度条的数据源；它衡量「还剩多少活没干」，因此不随队列筛选条件变化 */
export const ReviewProgressSchema = z
  .object({
    pending_total: z.number().int(),
    reviewed_today: z.number().int(),
    approved_today: z.number().int().openapi({ description: '只统计此刻仍是通过的记录，被撤销的不计入' }),
    rejected_today: z.number().int(),
  })
  .openapi('ReviewProgress')

export const ReviewQueueResponseSchema = PaginationFieldsSchema.extend({
  entries: z.array(ReviewQueueEntrySchema).openapi({ description: '按提交时间升序，先进先审' }),
  progress: ReviewProgressSchema,
}).openapi('ReviewQueueResponse')

/**
 * 审核详情（§8.2 右侧面板）。
 *
 * 面板要一次性画完，因此这里把参赛者、赛道、当前材料、审核历史与历史版本
 * 全部嵌在一个响应里：分成几个接口会让审核员在切换记录时看到画面逐块跳变，
 * 而审核是键盘驱动的高频操作。
 */
export const ReviewEntryDetailSchema = z
  .object({
    entry_id: z.string(),
    status: z.enum(ENTRY_STATUSES),
    version: z.number().int().openapi({ description: '乐观并发令牌，审核请求必须原样回传' }),
    activity_date: z.string(),
    submitted_at: z.string(),
    is_manual: z.boolean().openapi({ description: 'true 表示管理员补录，没有参赛者上传的材料' }),
    is_resubmission: z.boolean(),
    reopen_expires_at: z.string().nullable(),
    participant: z.object({
      id: z.string(),
      user_id: z.string(),
      student_id: z.string(),
      name: z.string(),
      class_name: z.string().nullable(),
      phone_suffix: z.string().nullable(),
      remark: z.string().nullable(),
      status: z.string(),
    }),
    campaign: z.object({ id: z.string(), name: z.string(), status: z.string() }),
    track: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
    current_revision: z
      .object({
        revision_id: z.string(),
        revision_number: z.number().int(),
        note: z.string().nullable(),
        submitted_at: z.string(),
        assets: z.array(
          z.object({
            asset_id: z.string(),
            width: z.number().int().nullable(),
            height: z.number().int().nullable(),
            sort_order: z.number().int(),
          }),
        ),
      })
      .nullable(),
    history: z.object({
      review_actions: z.array(
        z.object({
          id: z.string(),
          action: z.enum(REVIEW_ACTIONS),
          reason: z.string().nullable(),
          reason_code: z.string().nullable(),
          revision_id: z.string().nullable(),
          reviewer: z.object({ id: z.string(), name: z.string() }).nullable(),
          created_at: z.string(),
        }),
      ),
      /** 历史版本只给摘要：材料本身留在库里备查，审核页不需要渲染它们 */
      previous_revisions: z.array(
        z.object({
          revision_number: z.number().int(),
          submitted_at: z.string(),
          note: z.string().nullable(),
          asset_count: z.number().int(),
        }),
      ),
    }),
  })
  .openapi('ReviewEntryDetail')

/** 审核结论。approved/rejected 共用，用 action 区分本次动作 */
export const ReviewResultSchema = z
  .object({
    entry_id: z.string(),
    status: z.enum(ENTRY_STATUSES),
    version: z.number().int().openapi({ description: '自增后的新版本，下一次操作要回传它' }),
    reviewed_at: z.string().nullable(),
    reviewed_by: z.string().nullable(),
    rejection_code: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    action: z.enum(REVIEW_ACTIONS),
  })
  .openapi('ReviewResult')

// ---------------------------------------------------------------------------
// 异常处理
// ---------------------------------------------------------------------------

/**
 * 写操作之后返回的记录快照，供前端就地刷新那一行，不必重查整个列表。
 *
 * reopen / revoke / void 三个接口返回的字段完全一致 —— 它们在界面上是同一行
 * 记录上的三个按钮，共用同一个组件才能让前端只写一份「更新本地行」的逻辑。
 */
export const EntryStateSchema = z
  .object({
    entry_id: z.string(),
    status: z.enum(ENTRY_STATUSES),
    version: z.number().int(),
    activity_date: z.string(),
    reviewed_at: z.string().nullable(),
    reviewed_by: z.string().nullable(),
    rejection_code: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    reopen_expires_at: z.string().nullable(),
    is_manual: z.boolean(),
  })
  .openapi('EntryState')

/**
 * 重开结果。
 *
 * 比 EntryState 多两个字段，是因为「重开成功」不等于「参赛者就能交了」：
 * 活动本身不可提交时会返回 campaign_submittable=false 与一句 warning，
 * 让管理员当场知道这次重开只解除了截止时间限制。
 */
export const ReopenEntryResultSchema = EntryStateSchema.extend({
  campaign_submittable: z.boolean(),
  warning: z.string().nullable(),
}).openapi('ReopenEntryResult')

/** 补录结果：除记录状态外还要告诉前端补到了哪个参赛者的哪个赛道 */
export const ManualEntrySchema = EntryStateSchema.extend({
  participant_id: z.string(),
  track_id: z.string(),
  track_slug: z.string(),
  revision_id: z.string().openapi({ description: '补录同时创建的版本，详情页要按它取材料' }),
}).openapi('ManualEntry')

export const ScoreAdjustmentSchema = z
  .object({
    adjustment_id: z.string(),
    campaign_id: z.string(),
    participant_id: z.string(),
    track_id: z
      .string()
      .openapi({ description: '赛道 slug；总榜为 __overall__ 哨兵值，因此不是外键' }),
    points_delta: z.number().int().openapi({ description: '毫点，可为负' }),
    reason: z.string(),
    operator_id: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('ScoreAdjustment')

// ---------------------------------------------------------------------------
// 排行榜维护
// ---------------------------------------------------------------------------

export const LeaderboardRebuildResultSchema = z
  .object({
    snapshot_id: z.string(),
    cutoff_date: z.string(),
    row_count: z.number().int().openapi({ description: '本次写入的快照行数' }),
    generated_at: z.string(),
    regenerated: z.boolean().openapi({ description: 'true 表示覆盖了同一切算日的旧快照' }),
  })
  .openapi('LeaderboardRebuildResult')

export const LeaderboardFreezeResultSchema = z
  .object({
    snapshot_id: z.string(),
    cutoff_date: z.string(),
    row_count: z.number().int(),
    is_final: z.literal(true).openapi({ description: '冻结成功后恒为 true' }),
  })
  .openapi('LeaderboardFreezeResult')

export const LeaderboardUnfreezeResultSchema = z
  .object({
    cutoff_date: z.string(),
    is_final: z.literal(false).openapi({ description: '解冻后恒为 false' }),
  })
  .openapi('LeaderboardUnfreezeResult')

// ---------------------------------------------------------------------------
// 定时任务
// ---------------------------------------------------------------------------

/**
 * 已注册的调度计划。
 *
 * name 用 JobName 枚举而不是 string：前端的「手动触发」按钮会把这个值原样拼进
 * POST /admin/jobs/{name}/run，用 string 的话这一跳需要一次没有依据的类型断言。
 */
export const ScheduledJobSchema = z
  .object({
    name: z.enum(JOB_NAMES),
    expression: z.string().openapi({ description: 'cron 表达式，时区固定北京时间' }),
    description: z.string(),
  })
  .openapi('ScheduledJob')

export const ScheduledJobsResponseSchema = z
  .object({ jobs: z.array(ScheduledJobSchema) })
  .openapi('ScheduledJobsResponse')

/**
 * 手动触发的结果。
 *
 * 任务失败也返回 200 —— 失败信息就是这次的执行结果（error 里有原因），
 * 用 5xx 表达会让前端把它当成「请求没发出去」而重试。
 */
export const JobTriggerResultSchema = z
  .object({
    job_name: z.enum(JOB_NAMES),
    status: z.enum(JOB_RUN_STATUSES),
    processed: z.number().int().openapi({ description: '处理数量；失败与跳过锁时为 0' }),
    error: z.string().nullable(),
  })
  .openapi('JobTriggerResult')

// ---------------------------------------------------------------------------
// 管理后台：首页统计与列表
// ---------------------------------------------------------------------------

/**
 * 首页统计（§8.1）。
 *
 * 一次请求给出首页需要的全部数字：拆成多个接口只会让几个卡片先后跳数，
 * 而管理员打开首页就是想在一屏里看全。scheduled_jobs 由路由层拼上
 * （那是调度器的内存状态，service 层不必知道它），因此也在这个响应里。
 *
 * 注：next_update_at 与 seconds_until_next_update 在 service 的类型里声明为可空，
 * 实际实现总会算出一个值，这里如实描述声明的类型而非运行时的侥幸。
 */
export const DashboardStatsSchema = z
  .object({
    campaign: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      start_date: z.string(),
      end_date: z.string(),
      leaderboard_visible: z.boolean(),
    }),
    counts: z.object({
      participants_total: z.number().int().openapi({ description: '在册（active）的参赛者数' }),
      participants_activated: z.number().int(),
      participants_pending_activation: z.number().int(),
      participants_disabled: z.number().int(),
      today_submitted: z.number().int(),
      today_approved: z.number().int(),
      today_rejected: z.number().int(),
      pending_total: z.number().int(),
      pending_today: z.number().int(),
      entries_total: z.number().int(),
      approved_total: z.number().int(),
    }),
    tracks: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        enabled: z.boolean(),
        submitted_today: z.number().int(),
        approved_today: z.number().int(),
        submission_rate: z.number().openapi({ description: '今日提交人数 / 在册人数，保留三位小数' }),
      }),
    ),
    leaderboard: z.object({
      next_update_at: z.string().nullable(),
      seconds_until_next_update: z.number().int().nullable(),
      latest_snapshot: z
        .object({
          id: z.string(),
          cutoff_date: z.string(),
          generated_at: z.string(),
          is_final: z.boolean(),
          status: z.string(),
        })
        .nullable(),
      has_failure: z.boolean().openapi({ description: '最新一份快照生成失败，首页需要标红' }),
    }),
    last_job_run: z
      .object({
        job_name: z.string(),
        status: z.string(),
        started_at: z.string(),
        finished_at: z.string().nullable(),
        processed_count: z.number().int(),
        error_summary: z.string().nullable(),
      })
      .nullable(),
    /** 需要管理员关注的异常：失败的定时任务、生成失败的快照、冻结前仍有待审核 */
    warnings: z.array(
      z.object({
        kind: z.string().openapi({ example: 'job_failed' }),
        message: z.string(),
        at: z.string(),
      }),
    ),
    scheduled_jobs: z.array(ScheduledJobSchema),
  })
  .openapi('DashboardStats')

export const AuditLogListResponseSchema = PaginationFieldsSchema.extend({
  items: z.array(AuditLogEntrySchema).openapi({ description: '按时间倒序' }),
}).openapi('AuditLogListResponse')

export const JobRunListResponseSchema = PaginationFieldsSchema.extend({
  items: z.array(JobRunSchema).openapi({ description: '按开始时间倒序' }),
}).openapi('JobRunListResponse')

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
