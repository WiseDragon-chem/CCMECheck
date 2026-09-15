import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { AppError } from '../core/errors.js'

/**
 * design.md §7.2：连续登录失败需要触发限流，避免密码暴力尝试。
 *
 * 维度是 IP + 学号：只用 IP 会让同一教室 NAT 后的正常用户互相牵连，
 * 只用学号则挡不住撞库式扫描。
 * skipSuccessfulRequests 让正常用户不受影响，只统计失败尝试。
 */
function clientKey(req: { ip?: string; body?: unknown }): string {
  const body = req.body as { studentId?: unknown } | undefined
  const studentId = typeof body?.studentId === 'string' ? body.studentId.slice(0, 64) : ''
  return `${ipKeyGenerator(req.ip ?? '')}:${studentId}`
}

function limitExceeded(message: string) {
  return (_req: unknown, _res: unknown, next: (error: unknown) => void) =>
    next(new AppError('RATE_LIMITED', message))
}

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: clientKey,
  handler: limitExceeded('登录尝试过于频繁，请稍后再试'),
})

export const activateRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: clientKey,
  handler: limitExceeded('激活尝试过于频繁，请稍后再试'),
})

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitExceeded('请求过于频繁，请稍后再试'),
})
