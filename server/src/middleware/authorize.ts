import type { RequestHandler } from 'express'
import { ROLE_LEVEL, type Capability, type UserRole } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import { hasCapability } from '../core/principal.js'

/**
 * design.md §5：后端必须在每个受保护接口中验证权限，
 * 前端隐藏入口仅用于改善使用体验，不能充当权限控制手段。
 */

/** 要求角色等级不低于 minRole */
export function requireRole(minRole: UserRole): RequestHandler {
  return (req, _res, next) => {
    const principal = req.principal
    if (!principal) return next(new AppError('UNAUTHENTICATED', '请先登录'))
    if (ROLE_LEVEL[principal.role] < ROLE_LEVEL[minRole]) {
      return next(new AppError('ROLE_REQUIRED', `该操作需要 ${minRole} 及以上权限`))
    }
    next()
  }
}

/** 要求具备某项可配置能力（§5 中标注为「按权限配置」的条目） */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    const principal = req.principal
    if (!principal) return next(new AppError('UNAUTHENTICATED', '请先登录'))
    if (!hasCapability(principal, capability)) {
      return next(new AppError('CAPABILITY_REQUIRED', '当前账号没有执行该操作的权限'))
    }
    next()
  }
}

/**
 * 敏感操作前要求「新鲜的」认证。
 *
 * design.md §13 要求管理员敏感操作需要重新验证权限。这里用「令牌签发时间在 N 秒内」
 * 实现，而不是弹窗重输密码 —— §8.2 的审核流水线是键盘驱动的，弹密码框会打断节奏。
 */
export function requireFreshAuth(maxAgeSeconds = 300): RequestHandler {
  return (req, _res, next) => {
    const principal = req.principal
    if (!principal) return next(new AppError('UNAUTHENTICATED', '请先登录'))
    const ageSeconds = (Date.now() - principal.issuedAt.getTime()) / 1000
    if (ageSeconds > maxAgeSeconds) {
      return next(new AppError('REAUTH_REQUIRED', '该操作需要重新验证身份，请重新登录后再试'))
    }
    next()
  }
}
