import { env } from '../../config/env.js'
import { logger } from '../../core/logger.js'
import { addDays, cstToday } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { recordAudit } from '../../services/audit.service.js'
import { getStorage } from '../../storage/index.js'
import type { JobDefinition } from '../runner.js'

/**
 * 按保留期清理证明材料（design.md §18.8：「证明图片需要保留多久，
 * 活动结束后是否统一删除」）。
 *
 * 设计上刻意保守：
 *
 *   1. **默认不删**。EVIDENCE_RETENTION_DAYS 为 0（默认）时直接跳过。
 *      自动删除用户上传的材料是不可逆的破坏性操作，必须由组织者显式开启，
 *      不能靠一个默认值悄悄生效。
 *
 *   2. **先删库、后删文件**。和匿名化一样的顺序：如果先删文件而事务失败，
 *      库里会留下一堆指向空文件的记录，界面上就是「有记录但图片全裂」。
 *      反过来最坏只是留下孤儿文件，由 cleanup_orphan_uploads 回收。
 *
 *   3. **只删材料本身**。打卡记录、审核结论、积分全部保留 ——
 *      它们才是统计与审计需要的东西，且不含个人信息。
 */
export const purgeExpiredEvidenceJob: JobDefinition = {
  name: 'purge_expired_evidence',
  // 批量删除可能较慢，给更宽的锁有效期
  lockTtlSeconds: 60 * 60,

  async execute() {
    // 每次执行时读配置，而不是模块加载时读一次 ——
    // 否则改了 .env 必须重启进程，这个函数也没法针对不同保留期做测试
    return purgeExpiredEvidence(env.evidenceRetentionDays)
  },
}

/**
 * 按保留期清理证明材料，返回删除的素材数。
 *
 * @param retentionDays 活动结束后保留多少天；0 或负数表示不清理
 * @param now 便于测试注入的「现在」
 */
export async function purgeExpiredEvidence(retentionDays: number, now: Date = new Date()): Promise<number> {
  if (retentionDays <= 0) {
    // 未配置保留期 = 永不自动删除。这是默认状态，不是异常。
    return 0
  }

  const prisma = getPrismaClient()
  // 活动结束日早于这个日期的，材料算作过期
  const cutoffDate = addDays(cstToday(now), -retentionDays)

  const expired = await prisma.campaign.findMany({
    where: { endDate: { lt: cutoffDate } },
    select: { id: true, name: true, endDate: true },
  })

  if (expired.length === 0) return 0

  let totalDeleted = 0
  const objectKeys: string[] = []

  for (const campaign of expired) {
    // 先取对象键，再删库
    const assets = await prisma.submissionAsset.findMany({
      where: { revision: { entry: { campaignId: campaign.id } } },
      select: { objectKey: true },
    })
    if (assets.length === 0) continue

    const deleted = await runInTransaction(prisma, async (tx) => {
      // 备注是参赛者自由填写的内容，与截图同属证明材料
      await tx.submissionRevision.updateMany({
        where: { entry: { campaignId: campaign.id } },
        data: { note: null },
      })
      const result = await tx.submissionAsset.deleteMany({
        where: { revision: { entry: { campaignId: campaign.id } } },
      })

      // 删除材料是破坏性操作，即使由系统发起也要留痕
      await recordAudit(
        {
          actorId: null,
          action: 'evidence.purge',
          targetType: 'campaign',
          targetId: campaign.id,
          after: {
            reason: `活动结束超过 ${retentionDays} 天，按保留期删除证明材料`,
            campaign_name: campaign.name,
            end_date: campaign.endDate,
            deleted_assets: result.count,
          },
        },
        tx,
      )

      return result.count
    })

    objectKeys.push(...assets.map((asset) => asset.objectKey))
    totalDeleted += deleted

    logger.info(
      { campaign: campaign.name, end_date: campaign.endDate, deleted },
      '按保留期清理了该活动的证明材料',
    )
  }

  // 文件删除放在所有事务之后
  if (objectKeys.length > 0) {
    const storage = getStorage()
    for (const key of objectKeys) {
      try {
        await storage.delete(key)
      } catch {
        // 单个文件删不掉不该让任务失败，剩下的会被孤儿清理任务收走
      }
    }
    logger.info({ files: objectKeys.length, retention_days: retentionDays }, '证明材料文件清理完成')
  }

  return totalDeleted
}
