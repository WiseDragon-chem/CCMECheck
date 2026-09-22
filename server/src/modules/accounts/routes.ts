import { Router } from 'express'
import { route } from '../../core/route.js'
import { paginationToSkipTake } from '../../core/validation.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireFreshAuth, requireRole } from '../../middleware/authorize.js'
import { auditContextFrom } from '../../services/audit.service.js'
import {
  accountParamsSchema,
  createAccountBodySchema,
  listAccountsQuerySchema,
  updateAccountBodySchema,
} from './schema.js'
import * as accountsService from './service.js'

/**
 * 后台账号管理（design.md §5「管理管理员账号」）。
 *
 * 管的是 reviewer 与 super_admin 两种账号 —— 参赛者在名单页（modules/participants）。
 * §5 的权限矩阵里这一项只有超级管理员可用，因此整个 router 统一挂
 * requireRole('super_admin')，不在单个路由上重复声明。
 */
export function createAccountsRouter(): Router {
  const router = Router()

  router.use(authenticate, requireRole('super_admin'))

  /**
   * 三个写端点额外要求新鲜认证（§13「管理员敏感操作需要重新验证权限」）。
   *
   * 判断标准是不可逆性：禁用或降级一个后台账号会立刻掐断另一个管理员的全部会话，
   * 不比匿名化、冻结榜单轻。守卫顺序是「角色在前、新鲜度在后」——
   * 不让没有权限的人从「请重新登录」这个提示里推断出接口的存在。
   * GET 列表不加：看一眼账号列表不属于敏感操作。
   */
  const writeGuards = [requireFreshAuth()] as const

  // ---- 列表 ----
  router.get(
    '/',
    route({ query: listAccountsQuerySchema }, async ({ res, query }) => {
      const { skip, take } = paginationToSkipTake(query)
      const result = await accountsService.listAccounts({
        role: query.role,
        keyword: query.keyword,
        skip,
        take,
      })
      res.json({
        items: result.items,
        total: result.total,
        page: query.page,
        page_size: query.page_size,
        // 前端用它决定「禁用/降级」按钮是否置灰并给出说明；服务端仍然独立强制
        active_super_admin_count: result.activeSuperAdminCount,
      })
    }),
  )

  // ---- 创建 ----
  router.post(
    '/',
    ...writeGuards,
    route({ body: createAccountBodySchema }, async ({ req, res, body }) => {
      requirePrincipal(req)
      const result = await accountsService.createAccount({
        studentId: body.student_id,
        name: body.name,
        role: body.role,
        actor: auditContextFrom(req),
      })
      // 初始密码明文只在这里出现一次，之后库里只有哈希（§13）
      res.status(201).json(result)
    }),
  )

  // ---- 改名 / 改角色 / 启用禁用 ----
  router.patch(
    '/:accountId',
    ...writeGuards,
    route(
      { params: accountParamsSchema, body: updateAccountBodySchema },
      async ({ req, res, params, body }) => {
        requirePrincipal(req)
        const result = await accountsService.updateAccount({
          accountId: params.accountId,
          name: body.name,
          role: body.role,
          status: body.status,
          actor: auditContextFrom(req),
        })
        res.json(result)
      },
    ),
  )

  // ---- 重置密码 ----
  router.post(
    '/:accountId/reset-password',
    ...writeGuards,
    route({ params: accountParamsSchema }, async ({ req, res, params }) => {
      requirePrincipal(req)
      const result = await accountsService.resetAccountPassword({
        accountId: params.accountId,
        actor: auditContextFrom(req),
      })
      // 新密码明文同样只出现这一次
      res.json(result)
    }),
  )

  return router
}
