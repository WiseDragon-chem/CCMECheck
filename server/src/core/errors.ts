import { ERROR_STATUS, type ErrorCode } from '../config/constants.js'

export interface AppErrorOptions {
  /** 附加信息，会原样出现在响应体的 details 中。不得包含敏感数据。 */
  details?: Record<string, unknown>
  cause?: unknown
}

/**
 * 业务错误。所有可预期的失败都应抛出 AppError，由错误处理中间件
 * 统一转换成 design.md §12.5 规定的响应体。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.details = options.details
    if (options.cause !== undefined) this.cause = options.cause
    Error.captureStackTrace?.(this, AppError)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

// ---------------------------------------------------------------------------
// 常用构造器
// ---------------------------------------------------------------------------

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError('BAD_REQUEST', message, { details })

export const validationFailed = (message: string, details?: Record<string, unknown>) =>
  new AppError('VALIDATION_FAILED', message, { details })

export const unauthenticated = (message = '请先登录') => new AppError('UNAUTHENTICATED', message)

export const forbidden = (message = '没有权限执行该操作') => new AppError('FORBIDDEN', message)

export const notFound = (message = '资源不存在') => new AppError('NOT_FOUND', message)

export const conflict = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new AppError(code, message, { details })

export const internalError = (message = '服务器内部错误', cause?: unknown) =>
  new AppError('INTERNAL_ERROR', message, { cause })
