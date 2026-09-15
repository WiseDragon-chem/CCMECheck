import { Router } from 'express'
import { REJECT_REASON_CODES } from '../../config/constants.js'
import { route } from '../../core/route.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireRole } from '../../middleware/authorize.js'
import { auditContextFrom } from '../../services/audit.service.js'
import {
  approveReviewBodySchema,
  rejectReviewBodySchema,
  reviewEntryParamsSchema,
  reviewQueueQuerySchema,
} from './schema.js'
import { approveReview, getReviewEntryDetail, listReviewQueue, rejectReview } from './service.js'

/**
 * §8.2 流水线审核页面。
 *
 * 挂在 /admin/reviews 下；审核员及以上即可访问（§5：审核证明材料、查看全部参赛者记录）。
 * 路由层只做解析、调用服务、响应，事务与审计都在 service 内完成。
 */
export function createAdminReviewsRouter(): Router {
  const router = Router()

  /**
   * 守卫逐个挂在路由上，而不是 router.use(...)。
   * 本模块被挂到 /admin/reviews，而 /admin 下还挂着只允许超管的其他管理路由；
   * 若用 router.use 声明守卫，只要父级把 /admin 注册在本模块之前，
   * 一次 /admin/reviews/queue 请求就会先被 /admin 那层的超管守卫拦下。
   */
  const guards = [authenticate, requireRole('reviewer')] as const

  /**
   * 预设驳回原因（§8.2）。
   *
   * 前端驳回面板的下拉选项必须与校验逻辑同源，否则会出现「界面能选、后端拒绝」；
   * 因此这里直接返回常量表，而不是让前端自己抄一份。
   * 同样要注册在 /:entryId 之前。
   */
  router.get(
    '/reject-reasons',
    ...guards,
    route({}, async ({ res }) => {
      res.json({ reasons: REJECT_REASON_CODES })
    }),
  )

  /**
   * 待审核队列 + 审核进度（§8.2 左侧）。
   * 必须注册在 /:entryId 之前，否则 'queue' 会被当成 entryId 吃掉。
   */
  router.get(
    '/queue',
    ...guards,
    route({ query: reviewQueueQuerySchema }, async ({ res, query }) => {
      const payload = await listReviewQueue({
        track: query.track,
        activityDate: query.activity_date,
        className: query.class_name,
        page: query.page,
        pageSize: query.page_size,
      })
      res.json(payload)
    }),
  )

  /** 单条记录的详情：参赛者、赛道、当前材料与历史（§8.2 右侧） */
  router.get(
    '/:entryId',
    ...guards,
    route({ params: reviewEntryParamsSchema }, async ({ res, params }) => {
      res.json(await getReviewEntryDetail(params.entryId))
    }),
  )

  /** 审核通过（快捷键 A）。version 由详情面板带回来，用于乐观并发控制 */
  router.post(
    '/:entryId/approve',
    ...guards,
    route({ params: reviewEntryParamsSchema, body: approveReviewBodySchema }, async ({ req, res, params, body }) => {
      const principal = requirePrincipal(req)
      const result = await approveReview({
        entryId: params.entryId,
        version: body.version,
        note: body.note,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  /** 审核驳回（快捷键 R / Enter）。reason_code 必填，选「其他」时必须补充说明 */
  router.post(
    '/:entryId/reject',
    ...guards,
    route({ params: reviewEntryParamsSchema, body: rejectReviewBodySchema }, async ({ req, res, params, body }) => {
      const principal = requirePrincipal(req)
      const result = await rejectReview({
        entryId: params.entryId,
        version: body.version,
        reasonCode: body.reason_code,
        reason: body.reason,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  return router
}
