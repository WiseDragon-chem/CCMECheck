import { getPrismaClient } from '../../db/client.js'
import { pruneExpiredLocks } from '../lock.js'
import type { JobDefinition } from '../runner.js'

/** 已撤销的会话保留一段时间，便于排查「为什么被登出了」 */
const REVOKED_SESSION_RETENTION_DAYS = 7
const ACTIVATION_TOKEN_RETENTION_DAYS = 30

/**
 * 每小时清理失效的登录会话与激活码（design.md §14）。
 *
 * 顺带清理超期的任务锁，避免 job_locks 表无限增长。
 */
export const cleanupSessionsJob: JobDefinition = {
  name: 'cleanup_sessions',

  async execute() {
    const prisma = getPrismaClient()
    const now = new Date()
    const revokedCutoff = new Date(now.getTime() - REVOKED_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const tokenCutoff = new Date(now.getTime() - ACTIVATION_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000)

    // 过期的会话直接删；已撤销的留一段观察期
    const expiredSessions = await prisma.refreshSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedCutoff } }],
      },
    })

    // 激活码一旦用过或过期就失去价值，留一段审计期后删除
    const staleTokens = await prisma.activationToken.deleteMany({
      where: {
        AND: [
          { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
          { createdAt: { lt: tokenCutoff } },
        ],
      },
    })

    const prunedLocks = await pruneExpiredLocks()

    return expiredSessions.count + staleTokens.count + prunedLocks
  },
}
