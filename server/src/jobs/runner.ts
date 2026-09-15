import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { JOB_LOCK_TTL_SECONDS, type JobName, type JobRunStatus, type JobTrigger } from '../config/constants.js'
import { logger } from '../core/logger.js'
import { getPrismaClient } from '../db/client.js'
import { acquireJobLock, releaseJobLock } from './lock.js'

/**
 * 任务执行外壳（design.md §14）。
 *
 * 每个任务都经这里执行，从而统一获得：
 *   * job_locks 互斥 —— 同一任务不会并发跑两份；
 *   * job_runs 记录 —— 开始/结束时间、状态、处理数量、错误摘要；
 *   * 失败不抛出 —— 定时任务失败不该拖垮进程，但必须在首页可见。
 */

export interface JobContext {
  trigger: JobTrigger
  triggeredBy: string | null
  runId: string
}

export interface JobOutcome {
  status: JobRunStatus
  processed: number
  error?: string
}

export interface JobDefinition {
  name: JobName
  /** 单次执行最多占用多久，超过则锁自动失效 */
  lockTtlSeconds?: number
  execute: (context: JobContext) => Promise<number>
}

/** 进程标识，用于让锁能区分「谁持有」 */
export function jobHolder(): string {
  return `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
}

export async function runJob(
  definition: JobDefinition,
  options: { trigger?: JobTrigger; triggeredBy?: string | null; holder?: string } = {},
): Promise<JobOutcome> {
  const prisma = getPrismaClient()
  const trigger = options.trigger ?? 'cron'
  const triggeredBy = options.triggeredBy ?? null
  const holder = options.holder ?? jobHolder()

  const acquired = await acquireJobLock({
    name: definition.name,
    holder,
    ttlSeconds: definition.lockTtlSeconds ?? JOB_LOCK_TTL_SECONDS,
  })

  if (!acquired) {
    // 被别的实例占着，记一条 skipped_locked 便于排查「任务为什么没跑」
    await prisma.jobRun.create({
      data: { jobName: definition.name, status: 'skipped_locked', trigger, triggeredBy, finishedAt: new Date() },
    })
    logger.info({ job: definition.name }, '任务已被其他实例占用，跳过本次执行')
    return { status: 'skipped_locked', processed: 0 }
  }

  const run = await prisma.jobRun.create({
    data: { jobName: definition.name, status: 'running', trigger, triggeredBy },
  })

  const startedAt = Date.now()
  try {
    const processed = await definition.execute({ trigger, triggeredBy, runId: run.id })

    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: 'success', processedCount: processed, finishedAt: new Date() },
    })

    logger.info(
      { job: definition.name, processed, duration_ms: Date.now() - startedAt, trigger },
      '任务执行成功',
    )
    return { status: 'success', processed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        // 只留摘要，避免把整段堆栈塞进数据库
        errorSummary: message.slice(0, 500),
        finishedAt: new Date(),
      },
    })

    logger.error({ err: error, job: definition.name, duration_ms: Date.now() - startedAt }, '任务执行失败')
    return { status: 'failed', processed: 0, error: message }
  } finally {
    await releaseJobLock(definition.name, holder)
  }
}

/**
 * 启动时回收上一次进程崩溃留下的 running 记录。
 * 否则首页会一直显示「任务正在运行」，而实际上没有任何东西在跑。
 */
export async function recoverStaleJobRuns(): Promise<number> {
  const prisma = getPrismaClient()
  const result = await prisma.jobRun.updateMany({
    where: { status: 'running' },
    data: {
      status: 'failed',
      errorSummary: '进程在任务完成前退出（启动时自动回收）',
      finishedAt: new Date(),
    },
  })
  if (result.count > 0) {
    logger.warn({ count: result.count }, '回收了上次进程残留的运行中任务记录')
  }
  return result.count
}
