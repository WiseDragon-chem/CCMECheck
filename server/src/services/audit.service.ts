import type { Db } from '../db/client.js'
import { getPrismaClient } from '../db/client.js'
import { logger } from '../core/logger.js'

/**
 * 审计日志（design.md §8.4、§8.5、§16.14）。
 *
 * 所有管理员变更操作都必须调用 recordAudit；高风险操作额外记录修改前后的值。
 * 审计表只追加，不提供任何更新或删除路径。
 */

/** 这些键即使出现在 before/after 里也必须剔除（§13：日志中不得记录密码与令牌） */
const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'activationCode',
  'token',
  'refreshToken',
  'tokenHash',
  'sig',
  'signature',
])

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactValue(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redactValue(nested, depth + 1)
    }
    return result
  }
  return value
}

function serialize(data: unknown): string | null {
  if (data === undefined || data === null) return null
  try {
    return JSON.stringify(redactValue(data))
  } catch {
    return null
  }
}

export interface AuditEntry {
  actorId?: string | null
  /** 稳定的动作标识，例如 review.approve、participant.import.commit */
  action: string
  targetType?: string | null
  targetId?: string | null
  before?: unknown
  after?: unknown
  requestId?: string | null
  ip?: string | null
}

/**
 * 写入一条审计记录。
 *
 * 传入 tx 时与业务写入同事务提交 —— 审核、补录这类操作应当如此，
 * 避免出现「业务成功但审计丢失」。
 */
export async function recordAudit(entry: AuditEntry, tx?: Db): Promise<void> {
  const db = tx ?? getPrismaClient()
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        beforeData: serialize(entry.before),
        afterData: serialize(entry.after),
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
      },
    })
  } catch (error) {
    // 审计写入失败不应让业务操作回滚，但必须留下痕迹以便排查
    logger.error({ err: error, action: entry.action, target_id: entry.targetId }, '审计日志写入失败')
  }
}

/** 从请求中提取审计所需的上下文 */
export function auditContextFrom(req: {
  id?: string
  ip?: string
  principal?: { userId: string }
}): Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'> {
  return {
    actorId: req.principal?.userId ?? null,
    requestId: req.id ?? null,
    ip: req.ip ?? null,
  }
}
