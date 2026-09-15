/**
 * 全局领域常量。
 *
 * SQLite 连接器不支持 enum，所以状态字段的取值集合在这里集中定义，
 * 由 Zod 枚举在 API 边界强制（design.md §10.2）。
 */

// ---------------------------------------------------------------------------
// 错误码目录
// ---------------------------------------------------------------------------

/**
 * 稳定错误码 → HTTP 状态码。
 * 前端按 code 分支，不依赖中文文案（design.md §12.5）。
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  ACTIVATION_INVALID: 400,
  UPLOAD_INVALID: 400,
  BAD_REQUEST: 400,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  SIGNATURE_INVALID: 401,
  REAUTH_REQUIRED: 401,
  ACCOUNT_DISABLED: 401,
  ACCOUNT_NOT_ACTIVATED: 401,

  FORBIDDEN: 403,
  ROLE_REQUIRED: 403,
  CAPABILITY_REQUIRED: 403,
  NOT_ENTRY_OWNER: 403,
  ACCOUNT_LOCKED: 403,

  NOT_FOUND: 404,

  CHECKIN_CLOSED: 409,
  CHECKIN_NOT_OPEN: 409,
  CHECKIN_ALREADY_APPROVED: 409,
  CAMPAIGN_NOT_ACTIVE: 409,
  CAMPAIGN_FROZEN: 409,
  TRACK_DISABLED: 409,
  DUPLICATE_SUBMISSION: 409,
  DUPLICATE_RECORD: 409,
  REVIEW_CONFLICT: 409,
  SNAPSHOT_FINALIZED: 409,
  PENDING_REVIEWS_REMAIN: 409,
  IMPORT_ALREADY_COMMITTED: 409,
  STATE_TRANSITION_INVALID: 409,

  RATE_LIMITED: 429,

  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>

export type ErrorCode = keyof typeof ERROR_STATUS

/**
 * 错误码目录的数组形式，供 Zod 生成枚举。
 *
 * 这样 OpenAPI 契约里 ErrorResponse.code 会是这串字面量的联合类型，
 * 而不是宽泛的 string —— 前端就能拿到编译器强制的穷尽性检查：
 * 新增一个错误码而前端没处理，`Record<ErrorCode, …>` 会直接编译不过。
 * 把错误码写进契约，比让前端照抄一份列表可靠。
 */
export const ERROR_CODE_VALUES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]

// ---------------------------------------------------------------------------
// 角色与权限
// ---------------------------------------------------------------------------

export const USER_ROLES = ['participant', 'reviewer', 'super_admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

/** 角色高低顺序，用于 requireRole 的「不低于」判断 */
export const ROLE_LEVEL: Record<UserRole, number> = {
  participant: 0,
  reviewer: 1,
  super_admin: 2,
}

export const USER_STATUSES = ['pending_activation', 'active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/**
 * §5 权限矩阵中标注为「按权限配置」的能力项。
 * 超级管理员始终拥有全部能力，无需在此列出。
 */
export const CAPABILITIES = ['reviews.revoke', 'exports.run'] as const
export type Capability = (typeof CAPABILITIES)[number]

// ---------------------------------------------------------------------------
// 活动
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['draft', 'published', 'active', 'settling', 'finished', 'archived'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/** 允许参赛者提交打卡的活动状态 */
export const SUBMITTABLE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['active']

/** 允许审核的活动状态（finished/archived 下仅超管可带审计覆写） */
export const REVIEWABLE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['active', 'settling']

export const NAME_DISPLAY_MODES = ['real', 'masked'] as const
export type NameDisplayMode = (typeof NAME_DISPLAY_MODES)[number]

export const TIE_BREAK_RULES = ['score_desc_valid_days_desc_reached_at_asc'] as const
export type TieBreakRule = (typeof TIE_BREAK_RULES)[number]

/** v1 只支持北京时间；整个设计建立在固定 +08:00 之上（design.md §6.2） */
export const SUPPORTED_TIMEZONES = ['Asia/Shanghai'] as const
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/** 中国不实行夏令时，固定偏移 */
export const CHINA_UTC_OFFSET_MINUTES = 8 * 60

// ---------------------------------------------------------------------------
// 打卡
// ---------------------------------------------------------------------------

export const ENTRY_STATUSES = ['pending', 'approved', 'rejected', 'revoked', 'void'] as const
export type EntryStatus = (typeof ENTRY_STATUSES)[number]

/** 只有审核通过的记录计分（design.md §6.4、§16.7） */
export const SCORING_ENTRY_STATUSES: readonly EntryStatus[] = ['approved']

export const REVIEW_ACTIONS = ['approve', 'reject', 'reopen', 'revoke', 'void', 'manual_create'] as const
export type ReviewActionType = (typeof REVIEW_ACTIONS)[number]

/**
 * §6.4 的状态机。key 为当前状态，value 为允许迁移到的状态集合。
 * 注意：超管作废（void）可从任意状态发起，因此不在此表约束。
 */
export const ENTRY_STATUS_TRANSITIONS: Record<EntryStatus, readonly EntryStatus[]> = {
  pending: ['pending', 'approved', 'rejected'],
  approved: ['pending', 'revoked'],
  rejected: ['pending', 'void'],
  revoked: ['void'],
  void: [],
}

/** §8.2 预设驳回原因 */
export const REJECT_REASON_CODES = [
  { code: 'screenshot_date_mismatch', label: '截图日期不符合' },
  { code: 'content_unrecognizable', label: '无法识别打卡内容' },
  { code: 'insufficient_amount', label: '运动时长或阅读量不足' },
  { code: 'duplicate_image', label: '图片重复' },
  { code: 'incomplete_proof', label: '证明材料不完整' },
  { code: 'other', label: '其他' },
] as const

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number]['code']

export const REJECT_REASON_CODE_VALUES = REJECT_REASON_CODES.map((item) => item.code) as unknown as readonly RejectReasonCode[]

/** 每赛道每日打卡一次，因此同一活动日同一赛道只有一条有效记录（design.md §6.3） */
export const CHECKIN_CLIENT_TOKEN_HEADER = 'x-client-token'

/**
 * §8.5 临时重新开放的默认时长与上限（分钟）。
 *
 * 重开必须带时限：无时限的重开会让该槽位永久绕开每日截止校验（§16.5），
 * 上限取一周，避免管理员误操作把窗口开到活动结束之后。
 */
export const DEFAULT_REOPEN_MINUTES = 120
export const MAX_REOPEN_MINUTES = 24 * 60 * 7

// ---------------------------------------------------------------------------
// 排行榜
// ---------------------------------------------------------------------------

/**
 * 总榜行使用固定哨兵值作为 track_id。
 * leaderboard_rows.track_id 刻意不设外键 —— 外键无法容纳哨兵行，
 * 而可空列在 SQLite 中 NULL 互不相等，会让唯一约束失效（design.md §11.2）。
 */
export const OVERALL_TRACK_SENTINEL = '__overall__'

export const SNAPSHOT_STATUSES = ['generating', 'ready', 'failed'] as const
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number]

export const JOB_TRIGGERS = ['cron', 'manual'] as const
export type JobTrigger = (typeof JOB_TRIGGERS)[number]

export const JOB_RUN_STATUSES = ['running', 'success', 'failed', 'skipped_locked'] as const
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number]

export const JOB_NAMES = [
  'leaderboard_snapshot',
  'cleanup_sessions',
  'cleanup_orphan_uploads',
  'campaign_state_transition',
  'leaderboard_rebuild',
  'database_backup',
] as const
export type JobName = (typeof JOB_NAMES)[number]

// ---------------------------------------------------------------------------
// 参赛者与导入
// ---------------------------------------------------------------------------

export const PARTICIPANT_STATUSES = ['active', 'disabled', 'anonymized'] as const
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number]

export const IMPORT_BATCH_STATUSES = ['previewed', 'committed', 'failed', 'expired'] as const
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number]

export const CSV_TEMPLATE_HEADERS = ['student_id', 'name', 'class_name', 'phone_suffix', 'remark'] as const

// ---------------------------------------------------------------------------
// 赛道的初始定义（seed 使用）
// ---------------------------------------------------------------------------

export const DEFAULT_TRACKS = [
  {
    slug: 'reading',
    name: '读书',
    description: '每日阅读打卡',
    icon: 'book',
    proofInstructions: '请上传包含阅读书名、当日日期与阅读页数或时长的截图。',
    sortOrder: 1,
  },
  {
    slug: 'vocabulary',
    name: '单词背诵',
    description: '每日单词背诵打卡',
    icon: 'language',
    proofInstructions: '请上传单词软件的学习记录截图，截图需显示当日日期与背诵数量。',
    sortOrder: 2,
  },
  {
    slug: 'fitness',
    name: '运动健身',
    description: '每日运动打卡',
    icon: 'run',
    proofInstructions: '请上传运动记录截图，截图需显示日期、运动类型与运动时长。',
    sortOrder: 3,
  },
] as const

// ---------------------------------------------------------------------------
// 上传限制的兜底值（活动未配置时使用）
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_IMAGES = 1
export const DEFAULT_MAX_IMAGES = 3
export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const DEFAULT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** 图片像素上限，防御解压炸弹 */
export const MAX_IMAGE_PIXELS = 50_000_000

/** 签名图片地址有效期（秒） */
export const SIGNED_URL_TTL_SECONDS = 600

// ---------------------------------------------------------------------------
// 任务与维护
// ---------------------------------------------------------------------------

/** 孤儿上传的宽限期，避免删掉写入与事务提交之间的对象 */
export const ORPHAN_UPLOAD_GRACE_HOURS = 24

/** 任务锁的默认持有时长 */
export const JOB_LOCK_TTL_SECONDS = 30 * 60

/** campaign_participants 表在数据库中的原始表名，锁行时使用 */
export const JOB_LOCK_HOLDER_PREFIX = 'pid'
