import type { Request, RequestHandler } from 'express'
import { CAPABILITIES, type Capability, type UserRole } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import type { AuthPrincipal } from '../core/principal.js'
import { getPrismaClient } from '../db/client.js'
import { verifyAccessToken } from '../services/tokens.service.js'

export function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization')
  if (!header) return null
  const [scheme, value] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null
  return value.trim() || null
}

function parseCapabilities(raw: string): Capability[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Capability =>
      typeof item === 'string' && (CAPABILITIES as readonly string[]).includes(item),
    )
  } catch {
    return []
  }
}

/**
 * 解析访问令牌并加载调用方。
 *
 * 除了签名与有效期，还校验三件事（design.md §7.2）：
 *   * 账号未被禁用、已完成激活；
 *   * 令牌签发时间不早于 password_changed_at —— 改密后旧令牌立即失效；
 *   * 对应刷新会话未被撤销 —— 退出登录后旧令牌立即失效。
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req)
    if (!token) throw new AppError('UNAUTHENTICATED', '请先登录')

    const claims = await verifyAccessToken(token)
    const prisma = getPrismaClient()

    const user = await prisma.user.findUnique({
      where: { id: claims.subject },
      select: {
        id: true,
        studentId: true,
        name: true,
        role: true,
        status: true,
        capabilities: true,
        passwordChangedAt: true,
      },
    })

    if (!user) throw new AppError('TOKEN_INVALID', '账号不存在')
    if (user.status === 'disabled') throw new AppError('ACCOUNT_DISABLED', '账号已被禁用')
    if (user.status === 'pending_activation') {
      throw new AppError('ACCOUNT_NOT_ACTIVATED', '账号尚未激活')
    }

    // passwordChangedAt 在写入时已截断到秒，因此同一秒内签发的令牌不会被误杀
    if (user.passwordChangedAt && claims.issuedAt.getTime() < user.passwordChangedAt.getTime()) {
      throw new AppError('TOKEN_INVALID', '密码已变更，请重新登录')
    }

    if (claims.sessionId) {
      const session = await prisma.refreshSession.findUnique({
        where: { id: claims.sessionId },
        select: { revokedAt: true },
      })
      if (session?.revokedAt) throw new AppError('TOKEN_INVALID', '会话已失效，请重新登录')
    }

    const principal: AuthPrincipal = {
      userId: user.id,
      studentId: user.studentId,
      name: user.name,
      role: user.role as UserRole,
      capabilities: parseCapabilities(user.capabilities),
      issuedAt: claims.issuedAt,
      sessionId: claims.sessionId,
    }

    req.principal = principal
    next()
  } catch (error) {
    next(error)
  }
}

/** 取出已认证身份，未认证时抛错（供 handler 内部使用） */
export function requirePrincipal(req: Request): AuthPrincipal {
  if (!req.principal) throw new AppError('UNAUTHENTICATED', '请先登录')
  return req.principal
}
