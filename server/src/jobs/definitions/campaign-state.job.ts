import { getPrismaClient } from '../../db/client.js'
import { recordAudit } from '../../services/audit.service.js'
import { computeAutoStatus } from '../../modules/campaigns/service.js'
import type { JobDefinition } from '../runner.js'

/**
 * 活动状态边界自动切换（design.md §14）。
 *
 * 设计文档只写了「活动状态边界自动切换」，没有给状态迁移表。
 * 这里按最小侵入的规则实现：
 *   published → active    当北京时间今天 >= 开始日期
 *   active    → settling  当北京时间今天 > 结束日期（当日截止已过）
 *
 * draft / finished / archived 一律不自动流转，由管理员手工操作 ——
 * 归档和冻结结算属于不可逆动作，不该由定时任务擅自执行。
 */
export const campaignStateJob: JobDefinition = {
  name: 'campaign_state_transition',

  async execute() {
    const prisma = getPrismaClient()
    const now = new Date()

    const candidates = await prisma.campaign.findMany({
      where: { status: { in: ['published', 'active'] } },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    })

    let transitioned = 0

    for (const campaign of candidates) {
      const nextStatus = computeAutoStatus(campaign, now)
      if (!nextStatus) continue

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: nextStatus },
      })

      // 状态流转会影响打卡与审核是否开放，属于需要留痕的变更
      await recordAudit({
        actorId: null,
        action: 'campaign.status.auto',
        targetType: 'campaign',
        targetId: campaign.id,
        before: { status: campaign.status },
        after: { status: nextStatus },
      })

      transitioned += 1
    }

    return transitioned
  },
}
