import { getPrismaClient } from '../../db/client.js'
import { generateSnapshot, resolveCronCutoffDate } from '../../services/snapshot.service.js'
import { requireCurrentCampaign } from '../../modules/campaigns/service.js'
import type { JobDefinition } from '../runner.js'

/**
 * 重算当前活动的排行榜（design.md §14 的「管理员触发：重算排行榜」）。
 *
 * §14 把重算排行榜列为任务，但它没有固定的触发时刻 —— 什么时候该重算，
 * 取决于管理员刚改动了哪条计分规则。因此它只登记在任务表里、只接受手动触发，
 * 不出现在调度计划里（GET /admin/jobs/scheduled 不会列出它）。
 *
 * 统计截止日的选择与 POST /admin/leaderboards/rebuild 保持一致：优先重算最近一份快照，
 * 一份都还没有时按快照任务的口径算到前一日；活动尚未开始时无事可做。
 * 幂等由 generateSnapshot 内部的 (campaign_id, cutoff_date) 唯一约束 + 先删后插保证，
 * 因此重复触发不会产生第二份结果，也不会与整点快照任务互相覆盖出脏数据。
 */
export const leaderboardRebuildJob: JobDefinition = {
  name: 'leaderboard_rebuild',

  async execute({ trigger, triggeredBy }) {
    const prisma = getPrismaClient()
    const campaign = await requireCurrentCampaign(prisma)

    const latest = await prisma.leaderboardSnapshot.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { cutoffDate: 'desc' },
      select: { cutoffDate: true },
    })

    const cutoffDate = latest?.cutoffDate ?? resolveCronCutoffDate(campaign)
    if (!cutoffDate) return 0

    // 榜单已冻结时 generateSnapshot 会抛 SNAPSHOT_FINALIZED，这里刻意不吞掉：
    // 手动重算失败必须让管理员看到「请先解冻」这个可操作的原因，而不是一条静默的成功记录。
    const result = await generateSnapshot({
      campaignId: campaign.id,
      cutoffDate,
      trigger,
      triggeredBy,
    })

    return result.rowCount
  },
}
