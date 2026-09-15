import { Router } from 'express'
import { createAdminJobsRouter } from './modules/admin-jobs/routes.js'
import { createAdminOpsRouter } from './modules/admin-ops/routes.js'
import { createAssetsRouter } from './modules/assets/routes.js'
import { createAdminAuditRouter } from './modules/audit/routes.js'
import { createAuthRouter } from './modules/auth/routes.js'
import { createAdminCampaignsRouter, createCampaignsRouter } from './modules/campaigns/routes.js'
import { createCheckinsRouter } from './modules/checkins/routes.js'
import { createAdminDashboardRouter } from './modules/dashboard/routes.js'
import { createAdminExportsRouter } from './modules/exports/routes.js'
import { createAdminLeaderboardsRouter, createLeaderboardsRouter } from './modules/leaderboards/routes.js'
import { createAdminParticipantsRouter } from './modules/participants/routes.js'
import { createAdminReviewsRouter } from './modules/reviews/routes.js'
import { createUsersRouter } from './modules/users/routes.js'
import { createOpenApiRouter } from './openapi/routes.js'

/**
 * /api/v1 下的路由装配（design.md §12）。
 *
 * 各模块的 router 只负责自己的路径段，权限守卫挂在各模块内部的路由上 ——
 * 这样新增路由时漏挂守卫的风险被限制在单个模块内，
 * 而不是散落在这份装配表里。
 */
export function registerApiRoutes(): Router {
  const api = Router()

  // ---- 参赛者侧 ----
  api.use('/auth', createAuthRouter())
  api.use('/users', createUsersRouter())
  api.use('/campaigns', createCampaignsRouter())
  api.use('/checkins', createCheckinsRouter())
  api.use('/leaderboards', createLeaderboardsRouter())
  // 凭签名取图片字节，刻意不挂 authenticate —— <img> 无法携带 Bearer 令牌
  api.use('/assets', createAssetsRouter())

  // OpenAPI 文档与（非生产环境的）Swagger UI
  api.use('/', createOpenApiRouter())

  // ---- 管理侧 ----
  // 更具体的路径先挂：admin-ops 挂在 /admin 根上，顺序错了会把后面几个吃掉。
  // 各模块的守卫都挂在各自的路由上而不是 router 级，所以顺序只影响路径匹配。
  api.use('/admin/campaign', createAdminCampaignsRouter())
  api.use('/admin/leaderboards', createAdminLeaderboardsRouter())
  api.use('/admin/exports', createAdminExportsRouter())
  api.use('/admin/audit-logs', createAdminAuditRouter())
  api.use('/admin/jobs', createAdminJobsRouter())
  api.use('/admin/dashboard', createAdminDashboardRouter())
  api.use('/admin/participants', createAdminParticipantsRouter())
  api.use('/admin/reviews', createAdminReviewsRouter())
  // 补录、撤销、作废、积分调整（design.md §8.5）
  api.use('/admin', createAdminOpsRouter())

  return api
}
