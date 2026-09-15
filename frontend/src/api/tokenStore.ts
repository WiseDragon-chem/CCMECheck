/**
 * 访问令牌只存在内存里。
 *
 * 不进 localStorage、不进任何持久化 store —— 那是 XSS 可以明文读到的位置，
 * 而访问令牌能直接冒充用户。
 *
 * 代价是刷新页面后令牌丢失。这不是问题：应用启动时先调一次
 * POST /auth/refresh（HttpOnly Cookie 由浏览器自动带上）换回新令牌。
 * 这正好就是 design.md §7.2 的「保持登录状态」——
 * 隔天打开仍是登录态，而令牌始终不落地。
 */

let accessToken: string | null = null
let expiresAtMs = 0
let ttlMs = 0

/** 走完 TTL 的这个比例后就开始主动刷新 */
const REFRESH_AHEAD_RATIO = 0.8

export function setAccessToken(token: string, expiresInSeconds: number): void {
  accessToken = token
  ttlMs = expiresInSeconds * 1000
  expiresAtMs = Date.now() + ttlMs
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken(): void {
  accessToken = null
  expiresAtMs = 0
  ttlMs = 0
}

export function hasToken(): boolean {
  return accessToken !== null
}

export function expiresAt(): number {
  return expiresAtMs
}

/**
 * 是否该主动刷新了。
 *
 * 主动刷新是为了让常规情况根本不走 401 路径 ——
 * 一次 401 若发生在三张图上传的中途，那次上传就白费了。
 * 401 拦截器仍然保留作兜底。
 */
export function shouldRefreshProactively(): boolean {
  if (!accessToken || ttlMs === 0) return false
  return Date.now() >= expiresAtMs - ttlMs * (1 - REFRESH_AHEAD_RATIO)
}

/**
 * 页面从后台切回前台时调用。
 *
 * 手机会挂起定时器，主动刷新的定时器经常根本没触发；
 * 回到前台时若发现已接近过期就立刻补一次。
 */
export function isNearExpiry(thresholdSeconds = 120): boolean {
  if (!accessToken) return false
  return expiresAtMs - Date.now() <= thresholdSeconds * 1000
}
