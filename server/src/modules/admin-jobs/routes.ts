import { Router } from 'express'
import { z } from 'zod'
import { JOB_NAMES, JOB_RUN_STATUSES } from '../../config/constants.js'
import { AppError } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { paginationSchema } from '../../core/validation.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireFreshAuth, requireRole } from '../../middleware/authorize.js'
import { auditContextFrom, recordAudit } from '../../services/audit.service.js'
import { listScheduledJobs, triggerJob } from '../../jobs/scheduler.js'

const listRunsQuerySchema = z
  .object({
    job_name: z.enum(JOB_NAMES).optional(),
    status: z.enum(JOB_RUN_STATUSES).optional(),
  })
  .merge(paginationSchema)

const jobNameParamsSchema = z.object({
  name: z.enum(JOB_NAMES),
})

/**
 * 定时任务的运维视图（design.md §14 的「每次任务需要记录开始时间、结束时间、
 * 执行状态、处理数量和错误摘要」需要一个读取入口）。
 */
export function createAdminJobsRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('super_admin'))

  /** 已注册的调度计划 */
  router.get(
    '/scheduled',
    route({}, async ({ res }) => {
      res.json({ jobs: listScheduledJobs() })
    }),
  )

  /** 执行历史 */
  router.get(
    '/runs',
    route({ query: listRunsQuerySchema }, async ({ res, query }) => {
      const prisma = getPrismaClient()
      const where = {
        ...(query.job_name ? { jobName: query.job_name } : {}),
        ...(query.status ? { status: query.status } : {}),
      }

      const [total, items] = await Promise.all([
        prisma.jobRun.count({ where }),
        prisma.jobRun.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip: (query.page - 1) * query.page_size,
          take: query.page_size,
          include: { triggeredByUser: { select: { studentId: true, name: true } } },
        }),
      ])

      res.json({
        items: items.map((run) => ({
          id: run.id,
          job_name: run.jobName,
          status: run.status,
          trigger: run.trigger,
          triggered_by: run.triggeredByUser
            ? { student_id: run.triggeredByUser.studentId, name: run.triggeredByUser.name }
            : null,
          started_at: run.startedAt.toISOString(),
          finished_at: run.finishedAt?.toISOString() ?? null,
          processed_count: run.processedCount,
          error_summary: run.errorSummary,
        })),
        total,
        page: query.page,
        page_size: query.page_size,
      })
    }),
  )

  /** 手动触发某个任务 */
  router.post(
    '/:name/run',
    requireFreshAuth(),
    route({ params: jobNameParamsSchema }, async ({ req, res, params }) => {
      const principal = requirePrincipal(req)
      const outcome = await triggerJob(params.name, { triggeredBy: principal.userId })

      if (!outcome) throw new AppError('NOT_FOUND', '任务不存在')

      await recordAudit({
        ...auditContextFrom(req),
        action: 'job.trigger',
        targetType: 'job',
        targetId: params.name,
        after: { status: outcome.status, processed: outcome.processed },
      })

      res.json({
        job_name: params.name,
        status: outcome.status,
        processed: outcome.processed,
        error: outcome.error ?? null,
      })
    }),
  )

  return router
}
