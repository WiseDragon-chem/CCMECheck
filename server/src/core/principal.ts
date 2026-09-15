import type { Capability, UserRole } from '../config/constants.js'

/** 通过访问令牌解析出的调用方身份 */
export interface AuthPrincipal {
  userId: string
  studentId: string
  name: string
  role: UserRole
  capabilities: Capability[]
  /** 令牌签发时间，requireFreshAuth 用它判断是否「新鲜」 */
  issuedAt: Date
  /** 对应 refresh_sessions.id，退出登录时按会话撤销 */
  sessionId: string | null
}

/** §5：超级管理员拥有全部能力 */
export function hasCapability(principal: AuthPrincipal, capability: Capability): boolean {
  if (principal.role === 'super_admin') return true
  return principal.capabilities.includes(capability)
}
