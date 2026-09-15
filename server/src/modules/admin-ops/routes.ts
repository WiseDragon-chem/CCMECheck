import { Router } from 'express'
import { route } from '../../core/route.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireRole } from '../../middleware/authorize.js'
import { auditContextFrom } from '../../services/audit.service.js'
import {
  adminEntryParamsSchema,
  createManualEntryBodySchema,
  createScoreAdjustmentBodySchema,
  reopenEntryBodySchema,
  revokeEntryBodySchema,
  voidEntryBodySchema,
} from './schema.js'
import {
  createManualEntry,
  createScoreAdjustment,
  reopenEntry,
  revokeEntry,
  voidEntry,
} from './service.js'

/**
 * §8.5 异常处理。
 *
 * 挂在 /admin 下，整组要求超级管理员（§5：补录和重新开放打卡仅超管）。
 * 这些操作都会绕过正常的截止或状态约束，因此每个接口都强制填写原因，
 * 并在同一事务里写审计（§16.14）。
 */
export function createAdminOpsRouter(): Router {
  const router = Router()

  /**
   * 守卫逐个挂在路由上，而不是 router.use(...)。
   * 本模块被挂到 /admin，是 /admin 下最外层的一段；若用 router.use 声明超管守卫，
   * 只要父级把本模块注册在 /admin/reviews 之前，审核员的队列请求就会先被这里拦下。
   * 逐路由声明可以让本模块对不属于自己的路径完全无副作用。
   */
  const guards = [authenticate, requireRole('super_admin')] as const

  /** §8.5 临时重新开放某个打卡槽位：放宽该槽位的截止时间到 reopenExpiresAt */
  router.post(
    '/checkins/:entryId/reopen',
    ...guards,
    route({ params: adminEntryParamsSchema, body: reopenEntryBodySchema }, async ({ req, res, params, body }) => {
      const principal = requirePrincipal(req)
      const result = await reopenEntry({
        entryId: params.entryId,
        version: body.version,
        reason: body.reason,
        reopenMinutes: body.reopen_minutes,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  /** §8.5 撤销审核结果：approved → revoked，该记录的积分随之失效 */
  router.post(
    '/checkins/:entryId/revoke',
    ...guards,
    route({ params: adminEntryParamsSchema, body: revokeEntryBodySchema }, async ({ req, res, params, body }) => {
      const principal = requirePrincipal(req)
      const result = await revokeEntry({
        entryId: params.entryId,
        version: body.version,
        reason: body.reason,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  /** §8.5 作废违规记录：可从任意状态进入 void（终态） */
  router.post(
    '/checkins/:entryId/void',
    ...guards,
    route({ params: adminEntryParamsSchema, body: voidEntryBodySchema }, async ({ req, res, params, body }) => {
      const principal = requirePrincipal(req)
      const result = await voidEntry({
        entryId: params.entryId,
        version: body.version,
        reason: body.reason,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  /**
   * §8.5 管理员补录。
   * 路由注册在 /checkins/:entryId/... 之后也没关系：'manual' 只有一个路径段，
   * 不会和上面需要两段的动态路由冲突。
   */
  router.post(
    '/checkins/manual',
    ...guards,
    route({ body: createManualEntryBodySchema }, async ({ req, res, body }) => {
      const principal = requirePrincipal(req)
      const result = await createManualEntry({
        participantId: body.participant_id,
        trackRef: body.track_id,
        activityDate: body.activity_date,
        reason: body.reason,
        note: body.note,
        status: body.status,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.status(201).json(result)
    }),
  )

  /** §9.1 积分调整：只新增调整记录，绝不改动原始积分字段 */
  router.post(
    '/score-adjustments',
    ...guards,
    route({ body: createScoreAdjustmentBodySchema }, async ({ req, res, body }) => {
      const principal = requirePrincipal(req)
      const result = await createScoreAdjustment({
        participantId: body.participant_id,
        trackRef: body.track_id,
        pointsDelta: body.points_delta,
        reason: body.reason,
        actor: { userId: principal.userId, role: principal.role },
        audit: auditContextFrom(req),
      })
      res.status(201).json(result)
    }),
  )

  return router
}
