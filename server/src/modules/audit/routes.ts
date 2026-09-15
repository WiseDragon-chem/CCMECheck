import { Router } from 'express'
import { z } from 'zod'
import { route } from '../../core/route.js'
import { dateOnlySchema, paginationSchema } from '../../core/validation.js'
import { cstInstantOf, addDays } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireRole } from '../../middleware/authorize.js'

const listQuerySchema = z
  .object({
    actor_id: z.string().trim().min(1).max(64).optional(),
    action: z.string().trim().min(1).max(120).optional(),
    target_type: z.string().trim().min(1).max(64).optional(),
    target_id: z.string().trim().min(1).max(64).optional(),
    /** 按北京时间日期过滤（含首尾） */
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .merge(paginationSchema)

/** 审计表里存的是 JSON 字符串，脏数据不该让整个查询失败 */
function safeParse(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { _unparsable: true, raw }
  }
}

/**
 * 审计日志查询（design.md §12.4）。
 *
 * 审计表只追加，这里只提供读取，不提供任何写入或删除接口。
 */
export function createAdminAuditRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('super_admin'))

  router.get(
    '/',
    route({ query: listQuerySchema }, async ({ res, query }) => {
      const prisma = getPrismaClient()

      // 起止日期按北京时间理解，转成 UTC 瞬时再查
      const createdAt =
        query.from || query.to
          ? {
              ...(query.from ? { gte: cstInstantOf(query.from, '00:00') } : {}),
              ...(query.to ? { lte: cstInstantOf(addDays(query.to, 1), '00:00') } : {}),
            }
          : undefined

      const where = {
        ...(query.actor_id ? { actorId: query.actor_id } : {}),
        ...(query.action ? { action: { contains: query.action } } : {}),
        ...(query.target_type ? { targetType: query.target_type } : {}),
        ...(query.target_id ? { targetId: query.target_id } : {}),
        ...(createdAt ? { createdAt } : {}),
      }

      const [total, items] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.page_size,
          take: query.page_size,
          include: {
            actor: { select: { id: true, studentId: true, name: true, role: true } },
          },
        }),
      ])

      res.json({
        items: items.map((item) => ({
          id: item.id,
          actor: item.actor
            ? {
                id: item.actor.id,
                student_id: item.actor.studentId,
                name: item.actor.name,
                role: item.actor.role,
              }
            : null,
          action: item.action,
          target_type: item.targetType,
          target_id: item.targetId,
          before: safeParse(item.beforeData),
          after: safeParse(item.afterData),
          request_id: item.requestId,
          ip: item.ip,
          created_at: item.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        page_size: query.page_size,
      })
    }),
  )

  return router
}
