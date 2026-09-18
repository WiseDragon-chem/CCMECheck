import { AppError } from '../../core/errors.js'
import { logger } from '../../core/logger.js'
import { cstTimeOfDay } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import {
  findLatestSnapshot,
  generateSnapshot,
  markSnapshotFailed,
  resolveCronCutoffDate,
  resolveExpectedCutoffDate,
} from '../../services/snapshot.service.js'
import type { JobDefinition } from '../runner.js'

/**
 * 每日排行榜快照（design.md §9.2、§14）。
 *
 * 调度方式：每小时触发一次，在任务内部比对活动配置的排行榜时间。
 * 不直接用 cron 表达「06:00」是因为排行榜时间由管理员按活动配置（§8.4），
 * 写死 cron 表达式会导致改配置后需要重启进程才生效。
 *
 * 到点的那一次照常生成；**没到点的整点只做一件事：把漏跑的那一轮补上**。
 * 进程在排行榜时间不在线（开发机夜里关机、线上崩溃或重启）时那一轮会永久缺失，
 * 而排行榜只读最新一份快照 —— 不补的话它会一直停在几天前的截止日。
 *
 * 到点之后刻意不做「每个整点重算」：§9.2 要求 06:00 时仍待审核的记录进入**下一次**
 * 快照，每小时都重算会让当天白天才审核通过的记录混进当天的榜单。
 *
 * 幂等由 generateSnapshot 内部的 (campaign_id, cutoff_date) 唯一约束 + 先删后插保证，
 * 因此本任务重复执行（或与管理员手动重算撞车）都不会产生重复结果。
 */
export const leaderboardSnapshotJob: JobDefinition = {
  name: 'leaderboard_snapshot',

  async execute({ trigger, triggeredBy }) {
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
      // 声明在 try 外面，失败时要把它写进快照行的错误摘要
      let cutoffDate: string | null = null

      try {
        const isDueHour = Number(campaign.leaderboardTime.slice(0, 2)) === currentHour

        // 到点用「今天该产出的那一天」，没到点用「此刻本该有的那一天」。
        // 两者在整点排行榜时间的到点时刻相等，仅 leaderboardTime 不是整点时不同。
        cutoffDate = isDueHour
          ? resolveCronCutoffDate(campaign, now)
          : resolveExpectedCutoffDate(campaign, now)

        // 活动还没开始（前一日早于开始日期）时无事可做
        if (!cutoffDate) continue

        if (!isDueHour) {
          // 判据只看「可用」快照：一份 status='failed' 的记录不该让补跑以为已经跟上，
          // 否则参赛者端会一直停在旧截止日，首页的告警也一直挂着。
          // （管理员重算那边的判据相反，刻意算上 failed 的行，见 resolveRebuildCutoffDate）
          const latest = await findLatestSnapshot(campaign.id, prisma)
          if (latest && latest.cutoffDate >= cutoffDate) continue

          logger.warn(
            { campaign: campaign.name, expected: cutoffDate, latest: latest?.cutoffDate ?? null },
            '排行榜快照落后于应有进度，立即补生成',
          )
        }

        const result = await generateSnapshot({
          campaignId: campaign.id,
          cutoffDate,
          trigger,
          triggeredBy,
        })
        processed += result.rowCount
      } catch (error) {
        // 快照已冻结不是故障，跳过即可
        if (error instanceof AppError && error.code === 'SNAPSHOT_FINALIZED') continue

        const message = error instanceof Error ? error.message : String(error)
        // 保留上一份有效快照并留下警告（§14）：generateSnapshot 是单事务的先删后插，
        // 失败时整体回滚，旧快照不受影响
        if (cutoffDate) await markSnapshotFailed(campaign.id, cutoffDate, message)
        failures.push(`${campaign.name}(${cutoffDate ?? '截止日未定'}): ${message}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`以下活动的快照生成失败：${failures.join('；')}`)
    }

    return processed
  },
}
