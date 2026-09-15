import { Router } from 'express'
import { route } from '../../core/route.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireRole } from '../../middleware/authorize.js'
import { listScheduledJobs } from '../../jobs/scheduler.js'
import { getDashboardStats } from './service.js'

export function createAdminDashboardRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('reviewer'))

  /** 管理后台首页统计（design.md §8.1） */
  router.get(
    '/',
    route({}, async ({ res }) => {
      const stats = await getDashboardStats()
      // 顺带把调度器当前注册的任务一并返回，便于管理员核对「为什么某个点没跑」
      res.json({ ...stats, scheduled_jobs: listScheduledJobs() })
    }),
  )

  return router
}
