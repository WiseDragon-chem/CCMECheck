import { API_BASE_URL } from '@/config/env'
import { zh } from '@/locales/zh-CN'
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore'
import type { ErrorCode, ErrorResponseBody } from './types'

/** 后端返回的结构化错误。中文 message 只用于兜底展示，分支一律看 code。 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'UNKNOWN'
  readonly status: number
  readonly requestId: string | null
  readonly details: Record<string, unknown>

  constructor(params: {
    code: ErrorCode | 'UNKNOWN'
    status: number
    message: string
    requestId?: string | null
    details?: Record<string, unknown>
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.code = params.code
    this.status = params.status
    this.requestId = params.requestId ?? null
    this.details = params.details ?? {}
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

// ---------------------------------------------------------------------------
// 401 的分类
//
// 后端的 401 语义不能一刀切重试：
//   * TOKEN_EXPIRED / UNAUTHENTICATED —— 令牌过期或缺失，刷新后重放即可
//   * REAUTH_REQUIRED —— 敏感操作要求 5 分钟内的新鲜令牌；
//     刷新会给出新的 iat，因此刷新+重放能直接满足它。
//     它必须在「本次请求已经刷新过」的情况下仍然允许再刷一次。
//   * TOKEN_INVALID —— 会话被撤销或密码已变更。刷新也拿不到有效令牌，
//     重试只会陷入死循环，必须直接清状态。
//   * ACCOUNT_DISABLED / ACCOUNT_NOT_ACTIVATED —— 账号层面的拒绝，同理。
// ---------------------------------------------------------------------------

const REFRESHABLE: readonly ErrorCode[] = ['TOKEN_EXPIRED', 'UNAUTHENTICATED']
const FORCE_REFRESH: readonly ErrorCode[] = ['REAUTH_REQUIRED']
const TERMINAL: readonly ErrorCode[] = [
  'TOKEN_INVALID',
  'ACCOUNT_DISABLED',
  'ACCOUNT_NOT_ACTIVATED',
  'INVALID_CREDENTIALS',
]

/** 不需要带 Authorization 的路径 */
const ANONYMOUS_PATHS = ['/auth/login', '/auth/activate', '/auth/refresh']

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 直接传 FormData/Blob，跳过 JSON 序列化 */
  rawBody?: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// 刷新：单飞 + 跨标签页互斥
// ---------------------------------------------------------------------------

/**
 * 单飞的刷新。
 *
 * 主页面会并发发出多个请求，若各自触发刷新，后到的会拿着已被轮换掉的
 * 旧刷新令牌去换，全部失败并把用户踢下线。
 *
 * 跨标签页同理且更隐蔽：刷新令牌每次轮换，两个标签页同时刷新必然有一个
 * 拿到 TOKEN_INVALID。所以整个刷新过程用 navigator.locks 串行化
 * （不支持时退化为 localStorage 互斥）。
 */
let refreshInFlight: Promise<string> | null = null

/**
 * 令牌代际。每个请求记下自己出发时的代际；
 * 收到 401 时若发现代际已经变化，说明别的请求已经刷过了，
 * 直接拿新令牌重放，不必再刷一次。
 */
let authGeneration = 0

export function currentAuthGeneration(): number {
  return authGeneration
}

const REFRESH_LOCK = 'ccme-auth-refresh'
const REFRESH_STAMP_KEY = 'ccme:last-refresh'

function readLastRefresh(): number {
  try {
    return Number(window.localStorage.getItem(REFRESH_STAMP_KEY) ?? 0)
  } catch {
    return 0
  }
}

function writeLastRefresh(at: number): void {
  try {
    window.localStorage.setItem(REFRESH_STAMP_KEY, String(at))
  } catch {
    // 隐私模式下可能不可写，跨标签互斥退化为仅 navigator.locks
  }
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  // navigator.locks 在部分环境（含 jsdom）不存在，退化为直接执行
  if (typeof navigator === 'undefined' || !navigator.locks) return task()
  return navigator.locks.request(REFRESH_LOCK, task) as Promise<T>
}

async function performRefresh(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await parseErrorBody(response)
    clearAccessToken()
    throw new ApiError({
      code: body?.code ?? 'UNKNOWN',
      status: response.status,
      message: body?.message ?? zh.upload.sessionExpired,
      requestId: body?.request_id,
      details: body?.details,
    })
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  setAccessToken(data.access_token, data.expires_in)
  authGeneration += 1
  writeLastRefresh(Date.now())
  return data.access_token
}

export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = withRefreshLock(async () => {
      // 等锁期间别的标签页可能已经刷过了，这里再确认一次，避免无谓的轮换
      if (Date.now() - readLastRefresh() < 5_000 && getAccessToken()) {
        return getAccessToken() as string
      }
      return performRefresh()
    }).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// ---------------------------------------------------------------------------
// 会话失效通知
// ---------------------------------------------------------------------------

type AuthLostHandler = (error: ApiError) => void
let onAuthLost: AuthLostHandler | null = null

/** 由 auth store 注册：令牌彻底失效时清理状态并跳登录页 */
export function setAuthLostHandler(handler: AuthLostHandler | null): void {
  onAuthLost = handler
}

/**
 * 供其它传输层（目前只有 upload.ts 的 XHR）上报会话失效。
 * 会话失效的处理只有一处，不应该因为传输方式不同而各写一份。
 */
export function notifyAuthLost(error: ApiError): void {
  onAuthLost?.(error)
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

async function parseErrorBody(response: Response): Promise<ErrorResponseBody | null> {
  try {
    return (await response.json()) as ErrorResponseBody
  } catch {
    return null
  }
}

function buildHeaders(path: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const needsAuth = !ANONYMOUS_PATHS.some((prefix) => path.startsWith(prefix))
  const token = getAccessToken()
  if (needsAuth && token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * 发起请求并处理错误信封。
 *
 * 401 的处理见文件顶部「401 的分类」。任何请求最多重放一次，
 * 绝不无限重试 —— 那会把一次登录失效放大成请求风暴。
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, options, { retried: false, forceRetried: false })
}

/**
 * 重试状态。
 *
 * 两个标志位分开，而不是一个 boolean：
 * REAUTH_REQUIRED 允许在常规重放之后再强制刷新一次，
 * 但若不放任它重复，服务端持续返回该码时就会变成无限刷新。
 * 封顶总共两次重放。
 */
interface RetryState {
  /** 已经因令牌过期重放过一次 */
  retried: boolean
  /** 已经因 REAUTH_REQUIRED 强制刷新过一次 */
  forceRetried: boolean
}

async function send<T>(path: string, options: RequestOptions, state: RetryState): Promise<T> {
  const generationAtStart = authGeneration

  const headers = buildHeaders(path, options.headers)
  let body: BodyInit | undefined
  if (options.rawBody !== undefined) {
    body = options.rawBody
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    // 刷新令牌走 Cookie，必须带上
    credentials: 'include',
    body,
    signal: options.signal,
  })

  if (response.ok) {
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const errorBody = await parseErrorBody(response)
  const code: ErrorCode | 'UNKNOWN' = errorBody?.code ?? 'UNKNOWN'
  const error = new ApiError({
    code,
    status: response.status,
    message: errorBody?.message ?? zh.upload.requestFailed(response.status),
    requestId: errorBody?.request_id,
    details: errorBody?.details,
  })

  if (response.status !== 401) throw error

  // ---- 终止类：刷新也救不回来 ----
  if (code !== 'UNKNOWN' && TERMINAL.includes(code)) {
    clearAccessToken()
    onAuthLost?.(error)
    throw error
  }

  // ---- 分类 ----
  const force = code === 'REAUTH_REQUIRED'
  const refreshable = code === 'UNKNOWN' || REFRESHABLE.includes(code)

  if (!refreshable && !force) throw error

  // 强制刷新走独立的配额。放在常规配额之前判断 ——
  // 否则「上一次重放已经用掉了名额」会把 REAUTH_REQUIRED 直接挡掉，
  // 而它其实只需要一个 iat 更新的令牌，再刷一次就能满足。
  if (force ? state.forceRetried : state.retried) throw error

  const nextState: RetryState = force
    ? { ...state, forceRetried: true }
    : { ...state, retried: true }

  // 出发时是这一代、回来时已经变了 —— 别的请求刚刷过，直接复用新令牌重放
  if (!force && authGeneration > generationAtStart && getAccessToken()) {
    return send<T>(path, options, nextState)
  }

  try {
    await refreshAccessToken()
  } catch (refreshError) {
    onAuthLost?.(isApiError(refreshError) ? refreshError : error)
    throw error
  }

  return send<T>(path, options, nextState)
}

/** 供测试与特定流程使用 */
export const __internals = { REFRESHABLE, FORCE_REFRESH, TERMINAL }
