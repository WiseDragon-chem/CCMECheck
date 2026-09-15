import type { PrismaClient } from '../generated/prisma/client.js'

/**
 * SQLite 单写入者，写锁冲突是正常现象而非故障。
 * design.md §11.2 要求「写入冲突时短暂重试而不是立即报错」。
 */

const BUSY_PATTERNS = ['SQLITE_BUSY', 'database is locked', 'database table is locked', 'SQLITE_LOCKED']

export function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = 'code' in error ? String((error as { code: unknown }).code) : ''
  if (BUSY_PATTERNS.some((pattern) => code.includes(pattern))) return true

  const message = 'message' in error ? String((error as { message: unknown }).message) : ''
  return BUSY_PATTERNS.some((pattern) => message.includes(pattern))
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface WriteRetryOptions {
  attempts?: number
  /** 首次退避时长，之后指数增长 */
  baseDelayMs?: number
}

/**
 * 执行一段写入操作，遇到 SQLITE_BUSY 时退避重试。
 *
 * 注意：被包裹的必须是幂等或可安全重放的操作。如果内部已经在事务里，
 * 重放会重新开启事务，因此不要在手动事务块内部再包一层。
 */
export async function withWriteRetry<T>(operation: () => Promise<T>, options: WriteRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 5
  const baseDelayMs = options.baseDelayMs ?? 25

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isBusyError(error)) throw error
      lastError = error
      if (attempt === attempts - 1) break
      // 25 / 50 / 100 / 200 ms，加上少量抖动避免多进程同频重试
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 10)
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * 交互式事务 + SQLITE_BUSY 重试。
 *
 * Prisma 的 $transaction 在 busy 时会整体回滚，重试即重放整个事务体，
 * 因此事务体必须是幂等的（不要在其中做自增计数之外的外部副作用）。
 */
export async function runInTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  options: WriteRetryOptions = {},
): Promise<T> {
  return withWriteRetry(
    () => prisma.$transaction((tx) => operation(tx), { timeout: 15_000 }),
    options,
  )
}
