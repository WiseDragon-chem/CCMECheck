import { getPrismaClient } from '../db/client.js'
import { runInTransaction } from '../db/tx.js'

/**
 * 任务互斥（design.md §10.2：同一任务只会有一个实例执行）。
 *
 * 用数据库里的锁表而不是进程内标志位：后者在进程重启后失效，
 * 也无法阻止同一台机器上误起的第二个实例。
 *
 * 锁带过期时间而不是靠显式释放 —— 进程崩溃时不会留下永久死锁。
 */

export interface LockHandle {
  name: string
  holder: string
}

export async function acquireJobLock(params: {
  name: string
  holder: string
  ttlSeconds: number
}): Promise<boolean> {
  const prisma = getPrismaClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + params.ttlSeconds * 1000)

  return runInTransaction(prisma, async (tx) => {
    const existing = await tx.jobLock.findUnique({ where: { name: params.name } })

    if (!existing) {
      await tx.jobLock.create({
        data: { name: params.name, lockedAt: now, expiresAt, holder: params.holder },
      })
      return true
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      // 超期的锁视为持有者已崩溃，直接抢占
      await tx.jobLock.update({
        where: { name: params.name },
        data: { lockedAt: now, expiresAt, holder: params.holder },
      })
      return true
    }

    return false
  })
}

/** 只释放自己持有的锁，避免误删后来者的锁 */
export async function releaseJobLock(name: string, holder: string): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.jobLock.deleteMany({ where: { name, holder } })
}

/**
 * 清理超期的锁行。
 * 由 cleanup 任务顺带执行，避免锁表无限增长。
 */
export async function pruneExpiredLocks(): Promise<number> {
  const prisma = getPrismaClient()
  const result = await prisma.jobLock.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return result.count
}
