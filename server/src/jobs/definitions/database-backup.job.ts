import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env.js'
import { logger } from '../../core/logger.js'
import { cstToday, cstTimeOfDay } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import type { JobDefinition } from '../runner.js'

/**
 * 每日数据库备份（design.md §15）。
 *
 * 用 SQLite 的 `VACUUM INTO` 而不是复制文件：WAL 模式下直接拷贝 .db
 * 会漏掉还在 -wal 里的已提交事务，得到的备份可能缺数据甚至损坏。
 * `VACUUM INTO` 由 SQLite 自己生成一致性快照，且产出的是一个已整理的紧凑文件。
 *
 * 备份文件与数据库放在同一个根目录下，因此同样不能落在 OneDrive 等同步盘上。
 */
export const databaseBackupJob: JobDefinition = {
  name: 'database_backup',
  // 备份可能比常规任务慢，给一个更宽的锁有效期
  lockTtlSeconds: 60 * 60,

  async execute() {
    // 内存库无从备份（测试环境）
    if (env.databaseFile === ':memory:') return 0

    const prisma = getPrismaClient()
    await fs.mkdir(env.backupRoot, { recursive: true })

    // 文件名带北京时间与时分，便于人工辨认；VACUUM INTO 要求目标文件不存在
    const stamp = `${cstToday().replace(/-/g, '')}-${cstTimeOfDay().replace(':', '')}`
    const target = path.join(env.backupRoot, `dev-${stamp}.db`)

    await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

    const stat = await fs.stat(target)
    if (stat.size === 0) {
      // 空文件说明备份实际失败了，宁可报错也不要留下一个看似成功的产物
      await fs.unlink(target).catch(() => undefined)
      throw new Error('备份文件为空，VACUUM INTO 可能未成功执行')
    }

    logger.info({ path: target, bytes: stat.size }, '数据库备份完成')

    return 1 + (await pruneOldBackups())
  },
}

/** 删除超过保留期的备份，返回删除数量 */
async function pruneOldBackups(): Promise<number> {
  const cutoff = new Date(Date.now() - env.backupRetentionDays * 24 * 60 * 60 * 1000)

  let entries
  try {
    entries = await fs.readdir(env.backupRoot, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.db')) continue
    const full = path.join(env.backupRoot, entry.name)
    const info = await fs.stat(full)
    if (info.mtime < cutoff) {
      await fs.unlink(full)
      removed += 1
    }
  }
  return removed
}
