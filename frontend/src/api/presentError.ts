import { ApiError, isApiError } from './client'
import { UNKNOWN_ERROR_TEXT, fieldErrorsFrom, handlingFor, type ErrorSurface, type FieldError } from './errorMessages'

/**
 * 把任意异常转成界面可以直接用的形状。
 *
 * 每个页面都走这一个入口，避免各写一套 if-else ——
 * 那正是「有的页面显示了 request_id、有的没显示」这类不一致的来源。
 */
export interface PresentedError {
  surface: ErrorSurface
  text: string
  /** 服务端异常时带上，用于与 pino 日志对照 */
  requestId: string | null
  showRequestId: boolean
  /** 表单字段级错误，可直接 setFields */
  fields: FieldError[]
  code: string | null
}

export function presentError(error: unknown): PresentedError {
  if (!isApiError(error)) {
    return {
      surface: 'toast',
      text: error instanceof Error && error.message ? error.message : UNKNOWN_ERROR_TEXT,
      requestId: null,
      showRequestId: false,
      fields: [],
      code: null,
    }
  }

  return presentApiError(error)
}

export function presentApiError(error: ApiError): PresentedError {
  const handling = handlingFor(error.code === 'UNKNOWN' ? undefined : error.code)

  return {
    surface: handling.surface,
    // 服务端的中文文案通常比前端更准（含具体上下文），只在映射表明确覆盖时才替换
    text: handling.text ?? error.message,
    requestId: error.requestId,
    showRequestId: handling.showRequestId ?? false,
    fields: fieldErrorsFrom(error.details),
    code: error.code === 'UNKNOWN' ? null : error.code,
  }
}

/** 成功后展示的请求号，便于用户反馈问题时报给管理员 */
export function requestIdSuffix(requested: PresentedError): string {
  return requested.showRequestId && requested.requestId ? `（追踪号 ${requested.requestId}）` : ''
}
