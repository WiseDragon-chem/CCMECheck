import cron, { type ScheduledTask } from 'node-cron'
import { DEFAULT_TIMEZONE, type JobName, type JobTrigger } from '../config/constants.js'
import { logger } from '../core/logger.js'
import { campaignStateJob } from './definitions/campaign-state.job.js'
import { cleanupOrphanUploadsJob } from './definitions/cleanup-orphan-uploads.job.js'
import { cleanupSessionsJob } from './definitions/cleanup-sessions.job.js'
import { databaseBackupJob } from './definitions/database-backup.job.js'
import { leaderboardSnapshotJob } from './definitions/leaderboard-snapshot.job.js'
import { recoverStaleJobRuns, runJob, type JobDefinition } from './runner.js'

/**
 * 进程内定时任务调度器（design.md §10.2、§14）。
 *
 * HTTP 服务与调度器跑在同一个 Node 进程里 —— SQLite 只允许单写入者，
 * 拆成两个进程会引入跨进程写锁争用，收益却为零。
 *
 * 时区固定北京时间：node-cron 用 Node 内置 ICU 计算，不引入 tz 数据库依赖，
 * 与 design.md §6.2「不引入时区数据库」的约束一致。
 */

interface ScheduledJob {
  definition: JobDefinition
  expression: string
  description: string
}

const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    definition: leaderboardSnapshotJob,
    // 每小时整点触发，任务内部比对活动配置的排行榜时间。
    // 之所以不写成 `0 6 * * *`：排行榜时间可由管理员配置（§8.4），
    // 写死表达式会让改配置必须重启进程才生效。
    expression: '0 * * * *',
    description: '每日排行榜快照',
  },
  {
    definition: cleanupSessionsJob,
    // 错开整点，避免和快照任务抢同一瞬间
    expression: '17 * * * *',
    description: '清理失效会话与激活码',
  },
  {
    definition: cleanupOrphanUploadsJob,
    // 每日低峰期
    expression: '33 3 * * *',
    description: '清理孤儿上传',
  },
  {
    definition: campaignStateJob,
    expression: '*/5 * * * *',
    description: '活动状态边界切换',
  },
  {
    definition: databaseBackupJob,
    // 放在排行榜快照（整点，通常 06:00）与清理任务之外的时段，
    // 避免备份的 I/O 与快照的批量写入叠在一起
    expression: '47 4 * * *',
    description: '每日数据库备份',
  },
]

const runningTasks: ScheduledTask[] = []

export function startScheduler(options: { enabled?: boolean } = {}): void {
  if (options.enabled === false) {
    logger.info('定时任务调度器已禁用')
    return
  }

  void recoverStaleJobRuns().catch((error: unknown) => {
    logger.error({ err: error }, '回收残留任务记录失败')
  })

  for (const job of SCHEDULED_JOBS) {
    if (!cron.validate(job.expression)) {
      logger.error({ job: job.definition.name, expression: job.expression }, 'cron 表达式不合法，已跳过')
      continue
    }

    const task = cron.schedule(
      job.expression,
      () => {
        void runJob(job.definition, { trigger: 'cron' })
      },
      { timezone: DEFAULT_TIMEZONE, name: job.definition.name },
    )

    runningTasks.push(task)
    logger.info(
      { job: job.definition.name, expression: job.expression, description: job.description },
      '已注册定时任务',
    )
  }
}

export function stopScheduler(): void {
  for (const task of runningTasks) void task.stop()
  runningTasks.length = 0
}

const DEFINITIONS: Record<string, JobDefinition> = {
  [leaderboardSnapshotJob.name]: leaderboardSnapshotJob,
  [cleanupSessionsJob.name]: cleanupSessionsJob,
  [cleanupOrphanUploadsJob.name]: cleanupOrphanUploadsJob,
  [campaignStateJob.name]: campaignStateJob,
  [databaseBackupJob.name]: databaseBackupJob,
}

export function getJobDefinition(name: string): JobDefinition | undefined {
  return DEFINITIONS[name]
}

/** 管理员手动触发某个任务 */
export async function triggerJob(
  name: JobName | string,
  options: { triggeredBy?: string | null; trigger?: JobTrigger } = {},
) {
  const definition = getJobDefinition(name)
  if (!definition) return null

  return runJob(definition, {
    trigger: options.trigger ?? 'manual',
    triggeredBy: options.triggeredBy ?? null,
  })
}

export function listScheduledJobs(): Array<{ name: string; expression: string; description: string }> {
  return SCHEDULED_JOBS.map((job) => ({
    name: job.definition.name,
    expression: job.expression,
    description: job.description,
  }))
}
