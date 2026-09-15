import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { dateOnlySchema } from '../../core/validation.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireFreshAuth, requireRole } from '../../middleware/authorize.js'
import { auditContextFrom, recordAudit } from '../../services/audit.service.js'
import { generateSnapshot, freezeSnapshot, unfreezeSnapshot } from '../../services/snapshot.service.js'
import { requireCurrentCampaign } from '../campaigns/service.js'
import { latestLeaderboardQuerySchema, myRankQuerySchema } from './schema.js'
import { getLatestLeaderboard, getMyRank } from './service.js'

export function createLeaderboardsRouter(): Router {
  const router = Router()
  router.use(authenticate)

  /** 最新快照的分赛道榜或总榜（design.md §7.6、§12.3） */
  router.get(
    '/latest',
    route({ query: latestLeaderboardQuerySchema }, async ({ req, res, query }) => {
      const principal = requirePrincipal(req)
      res.json(await getLatestLeaderboard(principal, query))
    }),
  )

  /** 当前用户排名与附近名次 */
  router.get(
    '/me',
    route({ query: myRankQuerySchema }, async ({ req, res, query }) => {
      const principal = requirePrincipal(req)
      res.json(await getMyRank(principal, query))
    }),
  )

  return router
}

// ---------------------------------------------------------------------------
// 管理端（design.md §8.5）
// ---------------------------------------------------------------------------

const rebuildBodySchema = z.object({
  cutoff_date: dateOnlySchema.optional(),
  reason: z.string().trim().min(1, '请填写重算原因').max(500),
})

const freezeBodySchema = z.object({
  cutoff_date: dateOnlySchema.optional(),
  reason: z.string().trim().min(1, '请填写冻结原因').max(500),
})

const unfreezeBodySchema = z.object({
  cutoff_date: dateOnlySchema,
  reason: z.string().trim().min(1, '请填写解冻原因').max(500),
})

export function createAdminLeaderboardsRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('super_admin'))

  /** 重算排行榜 */
  router.post(
    '/rebuild',
    requireFreshAuth(),
    route({ body: rebuildBodySchema }, async ({ req, res, body }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)
      const principal = requirePrincipal(req)

      // 未指定统计截止日时，重算最近一份快照；一份都没有则重算到昨天
      const cutoffDate =
        body.cutoff_date ??
        (
          await prisma.leaderboardSnapshot.findFirst({
            where: { campaignId: campaign.id },
            orderBy: { cutoffDate: 'desc' },
            select: { cutoffDate: true },
          })
        )?.cutoffDate

      if (!cutoffDate) {
        throw new AppError('VALIDATION_FAILED', '尚无可重算的快照，请指定统计截止日期')
      }

      const result = await generateSnapshot({
        campaignId: campaign.id,
        cutoffDate,
        trigger: 'manual',
        triggeredBy: principal.userId,
      })

      await recordAudit({
        ...auditContextFrom(req),
        action: 'leaderboard.rebuild',
        targetType: 'leaderboard_snapshot',
        targetId: result.snapshotId,
        after: { cutoff_date: cutoffDate, row_count: result.rowCount, reason: body.reason },
      })

      res.json({
        snapshot_id: result.snapshotId,
        cutoff_date: result.cutoffDate,
        row_count: result.rowCount,
        generated_at: result.generatedAt.toISOString(),
        regenerated: result.regenerated,
      })
    }),
  )

  /** 冻结最终榜单 */
  router.post(
    '/freeze',
    requireFreshAuth(),
    route({ body: freezeBodySchema }, async ({ req, res, body }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)
      const principal = requirePrincipal(req)

      const result = await freezeSnapshot({
        campaignId: campaign.id,
        cutoffDate: body.cutoff_date,
        frozenBy: principal.userId,
      })

      await recordAudit({
        ...auditContextFrom(req),
        action: 'leaderboard.freeze',
        targetType: 'leaderboard_snapshot',
        targetId: result.snapshotId,
        after: { cutoff_date: result.cutoffDate, reason: body.reason },
      })

      res.json({
        snapshot_id: result.snapshotId,
        cutoff_date: result.cutoffDate,
        row_count: result.rowCount,
        is_final: true,
      })
    }),
  )

  /** 解冻（冻结后重新计算的前置操作） */
  router.post(
    '/unfreeze',
    requireFreshAuth(),
    route({ body: unfreezeBodySchema }, async ({ req, res, body }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)

      const before = await prisma.leaderboardSnapshot.findUnique({
        where: { campaignId_cutoffDate: { campaignId: campaign.id, cutoffDate: body.cutoff_date } },
        select: { id: true, isFinal: true },
      })

      await unfreezeSnapshot({ campaignId: campaign.id, cutoffDate: body.cutoff_date })

      await recordAudit({
        ...auditContextFrom(req),
        action: 'leaderboard.unfreeze',
        targetType: 'leaderboard_snapshot',
        targetId: before?.id ?? null,
        before: { is_final: before?.isFinal ?? null },
        after: { is_final: false, reason: body.reason },
      })

      res.json({ cutoff_date: body.cutoff_date, is_final: false })
    }),
  )

  return router
}
