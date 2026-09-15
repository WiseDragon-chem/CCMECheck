import { ORPHAN_UPLOAD_GRACE_HOURS } from '../../config/constants.js'
import { getPrismaClient } from '../../db/client.js'
import { getStorage } from '../../storage/index.js'
import type { JobDefinition } from '../runner.js'

const LOOKUP_CHUNK = 500

/**
 * 清理没有关联到正式提交的临时上传（design.md §14）。
 *
 * 会产生孤儿对象的两种情况：
 *   1. 图片已写入存储，但随后的数据库事务失败；
 *   2. 名单导入预览落盘的原始 CSV 没有走到提交。
 *
 * 宽限期是必需的：对象写入与事务提交之间存在时间差，
 * 没有宽限期就可能把「正在被写入的图片」当成孤儿删掉。
 */
export const cleanupOrphanUploadsJob: JobDefinition = {
  name: 'cleanup_orphan_uploads',

  async execute() {
    const prisma = getPrismaClient()
    const storage = getStorage()
    const cutoff = new Date(Date.now() - ORPHAN_UPLOAD_GRACE_HOURS * 60 * 60 * 1000)

    let removed = 0

    // ---- 1. 正式对象区 ----
    const keys = await storage.list()
    if (keys.length > 0) {
      const referenced = new Set<string>()
      for (let index = 0; index < keys.length; index += LOOKUP_CHUNK) {
        const chunk = keys.slice(index, index + LOOKUP_CHUNK)
        const rows = await prisma.submissionAsset.findMany({
          where: { objectKey: { in: chunk } },
          select: { objectKey: true },
        })
        for (const row of rows) referenced.add(row.objectKey)
      }

      for (const key of keys) {
        if (referenced.has(key)) continue
        // 只有超过宽限期才动，避免删掉刚开始写入的对象
        const info = await storage.stat(key).catch(() => null)
        if (!info || info.modifiedAt > cutoff) continue
        await storage.delete(key)
        removed += 1
      }
    }

    // ---- 2. 临时区（名单导入预览落盘的 CSV）----
    if (storage.cleanupTmp) {
      removed += await storage.cleanupTmp(cutoff)
    }

    return removed
  },
}
