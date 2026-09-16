import type { ErrorCode } from './types'

/**
 * design.md §12.5：前端按稳定的 code 分支，不依赖中文文案。
 *
 * 这张表把每个错误码映射到一个**处理方式**；文案只在需要覆盖服务端措辞时才写。
 * 类型是 Record<ErrorCode, …> 且 ErrorCode 来自契约，所以：
 * 服务端新增错误码而这里没处理，编译直接失败。
 */
export type ErrorSurface =
  /** 拦截器自己处理，不打扰用户（刷新令牌、重放请求） */
  | 'silent'
  /** 轻提示 */
  | 'toast'
  /** 落到表单字段上 */
  | 'inline'
  /** 需要用户决策的弹窗 */
  | 'modal'
  /** 不可继续：清理登录态并跳登录页 */
  | 'fatal'

export interface ErrorHandling {
  surface: ErrorSurface
  /** 覆盖服务端文案。不填则用服务端返回的 message。 */
  text?: string
  /** 是否需要把 request_id 一并展示（排查用） */
  showRequestId?: boolean
}

export const ERROR_HANDLING: Record<ErrorCode, ErrorHandling> = {
  // ---- 拦截器负责，用户不该看到 ----
  TOKEN_EXPIRED: { surface: 'silent' },
  UNAUTHENTICATED: { surface: 'silent' },
  REAUTH_REQUIRED: { surface: 'silent' },

  // ---- 无法继续，清登录态回登录页 ----
  TOKEN_INVALID: { surface: 'fatal', text: '登录状态已失效，请重新登录' },
  ACCOUNT_DISABLED: { surface: 'fatal', text: '账号已被禁用，请联系管理员' },
  ACCOUNT_NOT_ACTIVATED: { surface: 'fatal', text: '账号尚未激活' },
  INVALID_CREDENTIALS: { surface: 'inline' },

  // ---- 表单字段级 ----
  VALIDATION_FAILED: { surface: 'inline' },
  // 服务端刻意不区分「学号不存在」与「激活码错误」，前端文案也必须保持一致，
  // 不能自作聪明地分开提示
  ACTIVATION_INVALID: { surface: 'inline', text: '学号或激活码不正确，或激活码已失效' },

  // ---- 上传 ----
  UPLOAD_INVALID: { surface: 'inline' },

  // ---- 打卡相关：除了提示，调用方还应失效 today 让卡片重新取真值 ----
  CHECKIN_CLOSED: { surface: 'toast', text: '该活动日的打卡已经截止' },
  CHECKIN_NOT_OPEN: { surface: 'toast', text: '今日打卡尚未开放' },
  CHECKIN_ALREADY_APPROVED: {
    surface: 'toast',
    text: '该记录已审核通过，如需修改请联系管理员重新打开',
  },
  CAMPAIGN_NOT_ACTIVE: { surface: 'toast', text: '活动当前不在打卡进行中' },
  TRACK_DISABLED: { surface: 'toast', text: '该赛道当前未开放打卡' },
  CAMPAIGN_FROZEN: { surface: 'toast', text: '活动已结束' },
  STATE_TRANSITION_INVALID: { surface: 'toast' },

  /**
   * 重复提交不是错误 —— 那正是重复点击的预期结果。
   * 调用方应当按「已提交」处理：失效 today 并回主页，而不是弹错误。
   */
  DUPLICATE_SUBMISSION: { surface: 'silent' },
  DUPLICATE_RECORD: { surface: 'silent' },

  // ---- 权限 ----
  FORBIDDEN: { surface: 'toast', text: '没有权限执行该操作' },
  ROLE_REQUIRED: { surface: 'toast', text: '当前账号权限不足' },
  CAPABILITY_REQUIRED: { surface: 'toast', text: '当前账号没有执行该操作的权限' },
  NOT_ENTRY_OWNER: { surface: 'toast', text: '只能查看自己的证明材料' },

  // ---- 资源 ----
  NOT_FOUND: { surface: 'toast', text: '内容不存在或已被删除' },
  SIGNATURE_INVALID: { surface: 'toast', text: '图片地址已失效，正在重新加载' },

  // ---- 限流 ----
  RATE_LIMITED: { surface: 'toast', text: '操作过于频繁，请稍后再试' },

  // ---- 审核（管理端，本轮不使用，但契约要求全部覆盖）----
  REVIEW_CONFLICT: { surface: 'modal', text: '该记录在你打开后被修改过，请刷新后重试' },
  PENDING_REVIEWS_REMAIN: { surface: 'modal', text: '仍有待审核记录，请先完成审核' },
  SNAPSHOT_FINALIZED: { surface: 'toast', text: '该榜单已冻结，如需重算请先解冻' },
  IMPORT_ALREADY_COMMITTED: { surface: 'toast', text: '该批次已经导入过了' },

  // ---- 兜底 ----
  BAD_REQUEST: { surface: 'toast' },
  INTERNAL_ERROR: { surface: 'toast', text: '服务器出错了，请稍后重试', showRequestId: true },
}

/** 未知 code（契约漂移、网关插话）时的兜底文案 */
export const UNKNOWN_ERROR_TEXT = '出了点问题，请稍后重试'

export function handlingFor(code: ErrorCode | undefined): ErrorHandling {
  if (code && code in ERROR_HANDLING) return ERROR_HANDLING[code]
  return { surface: 'toast', text: UNKNOWN_ERROR_TEXT, showRequestId: true }
}

/**
 * 把服务端返回的 details.fields 映射回表单字段。
 *
 * 服务端给的消息本身就是中文字段级的，所以直接透传，只在结构不对时放弃。
 */
export interface FieldError {
  field: string
  message: string
}

export function fieldErrorsFrom(details: Record<string, unknown> | undefined): FieldError[] {
  const fields = details?.fields
  if (!Array.isArray(fields)) return []
  return fields.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const { field, message } = item as { field?: unknown; message?: unknown }
    if (typeof field !== 'string' || typeof message !== 'string') return []
    return [{ field, message }]
  })
}
