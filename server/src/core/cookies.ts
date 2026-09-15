import type { CookieOptions, Response } from 'express'
import { env } from '../config/env.js'

/**
 * 刷新令牌走 HttpOnly Cookie（design.md §7.2）。
 *
 * Secure 只在生产开启：本地 http 开发时带上 Secure，浏览器会直接丢弃 Cookie，
 * 表现为「登录成功但刷新总是失败」。
 * path 限定在 auth 路由下，避免每个接口请求都捎带刷新令牌。
 */
const REFRESH_COOKIE_PATH = '/api/v1/auth'

export function refreshCookieOptions(maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    domain: env.cookieDomain,
    path: REFRESH_COOKIE_PATH,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  }
}

export function setRefreshCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(env.cookieName, token, refreshCookieOptions(maxAgeMs))
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.cookieName, refreshCookieOptions())
}

export function readRefreshCookie(cookies: Record<string, unknown> | undefined): string | null {
  const value = cookies?.[env.cookieName]
  return typeof value === 'string' && value.length > 0 ? value : null
}
