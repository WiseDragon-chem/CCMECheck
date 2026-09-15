import { AppError } from '../../core/errors.js'
import { cstTimeOfDay } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import { generateSnapshot, markSnapshotFailed, resolveCronCutoffDate } from '../../services/snapshot.service.js'
import type { JobDefinition } from '../runner.js'

/**
 * 每日排行榜快照（design.md §9.2、§14）。
 *
 * 调度方式：每小时触发一次，在任务内部比对活动配置的排行榜时间。
 * 不直接用 cron 表达「06:00」是因为排行榜时间由管理员按活动配置（§8.4），
 * 写死 cron 表达式会导致改配置后需要重启进程才生效。
 *
 * 幂等由 generateSnapshot 内部的 (campaign_id, cutoff_date) 唯一约束 + 先删后插保证，
 * 因此本任务重复执行（或与管理员手动重算撞车）都不会产生重复结果。
 */
export const leaderboardSnapshotJob: JobDefinition = {
  name: 'leaderboard_snapshot',

  async execute() {
    const prisma = getPrismaClient()
    const now = new Date()
    const currentHour = Number(cstTimeOfDay(now).slice(0, 2))

    const campaigns = await prisma.campaign.findMany({
      where: { status: { in: ['active', 'settling'] } },
      select: { id: true, name: true, startDate: true, endDate: true, leaderboardTime: true },
    })

    let processed = 0
    const failures: string[] = []

    for (const campaign of campaigns) {
      if (Number(campaign.leaderboardTime.slice(0, 2)) !== currentHour) continue

      const cutoffDate = resolveCronCutoffDate(campaign, now)
      // 活动还没开始（前一日早于开始日期）时无事可做
      if (!cutoffDate) continue

      try {
        const result = await generateSnapshot({
          campaignId: campaign.id,
          cutoffDate,
          trigger: 'cron',
        })
        processed += result.rowCount
      } catch (error) {
        // 快照已冻结不是故障，跳过即可
        if (error instanceof AppError && error.code === 'SNAPSHOT_FINALIZED') continue

        const message = error instanceof Error ? error.message : String(error)
        // 保留上一份有效快照并留下警告（§14）：generateSnapshot 是单事务的先删后插，
        // 失败时整体回滚，旧快照不受影响
        await markSnapshotFailed(campaign.id, cutoffDate, message)
        failures.push(`${campaign.name}(${cutoffDate}): ${message}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`以下活动的快照生成失败：${failures.join('；')}`)
    }

    return processed
  },
}
