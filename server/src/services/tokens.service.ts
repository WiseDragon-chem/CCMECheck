import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import { env } from '../config/env.js'
import type { UserRole } from '../config/constants.js'
import { AppError } from '../core/errors.js'

/**
 * 短期访问令牌（JWT，HS256）。
 * 长期刷新令牌是随机串、只存哈希、走 HttpOnly Cookie，不在这里处理。
 */

const ISSUER = 'ccme-check'
const AUDIENCE = 'ccme-check-api'
const ALGORITHM = 'HS256'

const secretKey = new TextEncoder().encode(env.jwtSecret)

export interface AccessTokenClaims {
  /** 用户 id */
  subject: string
  /** refresh_sessions.id，退出登录时按会话撤销 */
  sessionId: string | null
  role: UserRole
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, role: claims.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .sign(secretKey)
}

export interface VerifiedAccessToken {
  subject: string
  sessionId: string | null
  role: UserRole
  issuedAt: Date
  expiresAt: Date
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    })

    if (!payload.sub || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
      throw new AppError('TOKEN_INVALID', '访问令牌缺少必要字段')
    }

    return {
      subject: payload.sub,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      role: (payload.role as UserRole) ?? 'participant',
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof joseErrors.JWTExpired) {
      throw new AppError('TOKEN_EXPIRED', '登录已过期，请重新登录')
    }
    throw new AppError('TOKEN_INVALID', '访问令牌无效', { cause: error })
  }
}
