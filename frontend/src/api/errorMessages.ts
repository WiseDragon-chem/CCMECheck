import { zh } from '@/locales/zh-CN'
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
  TOKEN_INVALID: { surface: 'fatal', text: zh.errorCode.TOKEN_INVALID },
  ACCOUNT_DISABLED: { surface: 'fatal', text: zh.errorCode.ACCOUNT_DISABLED },
  ACCOUNT_NOT_ACTIVATED: { surface: 'fatal', text: zh.errorCode.ACCOUNT_NOT_ACTIVATED },
  INVALID_CREDENTIALS: { surface: 'inline' },

  // ---- 表单字段级 ----
  VALIDATION_FAILED: { surface: 'inline' },
  // 服务端刻意不区分「学号不存在」与「激活码错误」，前端文案也必须保持一致，
  // 不能自作聪明地分开提示
  ACTIVATION_INVALID: { surface: 'inline', text: zh.errorCode.ACTIVATION_INVALID },

  // ---- 上传 ----
  UPLOAD_INVALID: { surface: 'inline' },

  // ---- 打卡相关：除了提示，调用方还应失效 today 让卡片重新取真值 ----
  CHECKIN_CLOSED: { surface: 'toast', text: zh.errorCode.CHECKIN_CLOSED },
  CHECKIN_NOT_OPEN: { surface: 'toast', text: zh.errorCode.CHECKIN_NOT_OPEN },
  CHECKIN_ALREADY_APPROVED: {
    surface: 'toast',
    text: zh.errorCode.CHECKIN_ALREADY_APPROVED,
  },
  CAMPAIGN_NOT_ACTIVE: { surface: 'toast', text: zh.errorCode.CAMPAIGN_NOT_ACTIVE },
  TRACK_DISABLED: { surface: 'toast', text: zh.errorCode.TRACK_DISABLED },
  CAMPAIGN_FROZEN: { surface: 'toast', text: zh.errorCode.CAMPAIGN_FROZEN },
  STATE_TRANSITION_INVALID: { surface: 'toast' },

  /**
   * 重复提交不是错误 —— 那正是重复点击的预期结果。
   * 调用方应当按「已提交」处理：失效 today 并回主页，而不是弹错误。
   */
  DUPLICATE_SUBMISSION: { surface: 'silent' },
  DUPLICATE_RECORD: { surface: 'silent' },

  // ---- 权限 ----
  FORBIDDEN: { surface: 'toast', text: zh.errorCode.FORBIDDEN },
  ROLE_REQUIRED: { surface: 'toast', text: zh.errorCode.ROLE_REQUIRED },
  CAPABILITY_REQUIRED: { surface: 'toast', text: zh.errorCode.CAPABILITY_REQUIRED },
  NOT_ENTRY_OWNER: { surface: 'toast', text: zh.errorCode.NOT_ENTRY_OWNER },

  // ---- 资源 ----
  NOT_FOUND: { surface: 'toast', text: zh.errorCode.NOT_FOUND },
  SIGNATURE_INVALID: { surface: 'toast', text: zh.errorCode.SIGNATURE_INVALID },

  // ---- 限流 ----
  RATE_LIMITED: { surface: 'toast', text: zh.errorCode.RATE_LIMITED },

  // ---- 审核（管理端，本轮不使用，但契约要求全部覆盖）----
  REVIEW_CONFLICT: { surface: 'modal', text: zh.errorCode.REVIEW_CONFLICT },
  PENDING_REVIEWS_REMAIN: { surface: 'modal', text: zh.errorCode.PENDING_REVIEWS_REMAIN },
  SNAPSHOT_FINALIZED: { surface: 'toast', text: zh.errorCode.SNAPSHOT_FINALIZED },
  IMPORT_ALREADY_COMMITTED: { surface: 'toast', text: zh.errorCode.IMPORT_ALREADY_COMMITTED },

  // ---- 兜底 ----
  BAD_REQUEST: { surface: 'toast' },
  INTERNAL_ERROR: { surface: 'toast', text: zh.errorCode.INTERNAL_ERROR, showRequestId: true },
}

/** 未知 code（契约漂移、网关插话）时的兜底文案 */
export const UNKNOWN_ERROR_TEXT = zh.error.unknown

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
