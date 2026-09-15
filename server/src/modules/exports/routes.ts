import { Router, type Response } from 'express'
import { z } from 'zod'
import { ENTRY_STATUSES } from '../../config/constants.js'
import { AppError } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { formatCstDateTime } from '../../core/time.js'
import { toCsv } from '../../core/text.js'
import { dateOnlySchema } from '../../core/validation.js'
import { addDays, cstToday } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireCapability, requireRole } from '../../middleware/authorize.js'
import { recordAudit, auditContextFrom } from '../../services/audit.service.js'
import { findLatestSnapshot } from '../../services/snapshot.service.js'
import { requireCurrentCampaign } from '../campaigns/service.js'
import { exportCheckinsCsv, exportLeaderboardCsv } from './service.js'

const checkinsQuerySchema = z.object({
  track: z.string().trim().min(1).max(64).optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
})

const leaderboardQuerySchema = z.object({
  cutoff_date: dateOnlySchema.optional(),
})

function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  // filename 里可能含中文（活动名），用 RFC 5987 的 filename* 更稳妥
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  )
  res.send(body)
}

/**
 * 数据导出（design.md §8.3、§12.4）。
 *
 * 导出权限除超管外，也开放给被授予 exports.run 能力的审核员（§5「按权限配置」）。
 */
export function createAdminExportsRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('reviewer'), requireCapability('exports.run'))

  /** 打卡明细 */
  router.get(
    '/checkins.csv',
    route({ query: checkinsQuerySchema }, async ({ req, res, query }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)

      const result = await exportCheckinsCsv(campaign.id, query, prisma)

      await recordAudit({
        ...auditContextFrom(req),
        action: 'export.checkins',
        targetType: 'campaign',
        targetId: campaign.id,
        after: { row_count: result.rowCount, filters: query },
      })

      sendCsv(res, result.filename, result.body)
    }),
  )

  /** 排行榜（活动结束后导出最终榜单用，design.md §3） */
  router.get(
    '/leaderboard.csv',
    route({ query: leaderboardQuerySchema }, async ({ req, res, query }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)

      // 未指定时优先用已冻结的最新快照的截止日，其次用昨天
      const frozen = await prisma.leaderboardSnapshot.findFirst({
        where: { campaignId: campaign.id, isFinal: true },
        orderBy: { cutoffDate: 'desc' },
        select: { cutoffDate: true },
      })
      const latest = frozen ?? (await findLatestSnapshot(campaign.id, prisma))
      const cutoffDate = query.cutoff_date ?? latest?.cutoffDate ?? addDays(cstToday(), -1)

      if (cutoffDate < campaign.startDate) {
        throw new AppError('VALIDATION_FAILED', '统计截止日期早于活动开始日期')
      }

      const result = await exportLeaderboardCsv(campaign.id, cutoffDate, prisma)

      await recordAudit({
        ...auditContextFrom(req),
        action: 'export.leaderboard',
        targetType: 'campaign',
        targetId: campaign.id,
        after: { row_count: result.rowCount, cutoff_date: cutoffDate },
      })

      sendCsv(res, result.filename, result.body)
    }),
  )

  /** 参赛者名册（§8.3 导出参赛者信息） */
  router.get(
    '/participants.csv',
    route({}, async ({ req, res }) => {
      const prisma = getPrismaClient()
      const campaign = await requireCurrentCampaign(prisma)
      const principal = requirePrincipal(req)

      const participants = await prisma.campaignParticipant.findMany({
        where: { campaignId: campaign.id },
        orderBy: [{ className: 'asc' }, { user: { studentId: 'asc' } }],
        include: { user: { select: { studentId: true, name: true, status: true } } },
      })

      const body = toCsv(
        ['学号', '姓名', '班级', '报名状态', '账号状态', '手机尾号', '备注', '加入时间(北京时间)'],
        participants.map((item) => [
          item.user.studentId,
          item.user.name,
          item.className ?? '',
          item.status,
          item.user.status,
          item.phoneSuffix ?? '',
          item.remark ?? '',
          formatCstDateTime(item.joinedAt),
        ]),
      )

      await recordAudit({
        ...auditContextFrom(req),
        action: 'export.participants',
        targetType: 'campaign',
        targetId: campaign.id,
        after: { row_count: participants.length, requested_by: principal.userId },
      })

      sendCsv(res, `participants-${new Date().toISOString().slice(0, 10)}.csv`, body)
    }),
  )

  return router
}
