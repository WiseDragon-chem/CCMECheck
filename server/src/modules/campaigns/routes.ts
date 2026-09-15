import { Router } from 'express'
import { AppError, notFound } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { cstTimeOfDay, cstToday } from '../../core/time.js'
import { getPrismaClient } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireFreshAuth, requireRole } from '../../middleware/authorize.js'
import { auditContextFrom, recordAudit } from '../../services/audit.service.js'
import {
  campaignTrackParamsSchema,
  createCampaignBodySchema,
  updateCampaignBodySchema,
  updateCampaignTrackBodySchema,
} from './schema.js'
import {
  getCampaignWithTracks,
  requireCurrentCampaign,
  toPublicCampaign,
  toPublicTrack,
} from './service.js'

/** 改动这些字段会改变已有记录的计分结果，属于 design.md §8.4 的高风险操作 */
const SCORING_FIELDS = ['start_date', 'end_date', 'daily_open_time', 'daily_deadline', 'status'] as const

function hasStarted(status: string): boolean {
  return status === 'active' || status === 'settling' || status === 'finished'
}

// ---------------------------------------------------------------------------
// 参赛者侧
// ---------------------------------------------------------------------------

export function createCampaignsRouter(): Router {
  const router = Router()

  router.get(
    '/current',
    authenticate,
    route({}, async ({ req, res }) => {
      requirePrincipal(req)
      const campaign = await requireCurrentCampaign()

      res.json({
        campaign: toPublicCampaign(campaign),
        tracks: campaign.campaignTracks.map(toPublicTrack),
        // 前端倒计时只用于提示，最终判定以服务器时间为准（design.md §7.3）
        server_time: new Date().toISOString(),
        activity_date: cstToday(),
        server_time_of_day: cstTimeOfDay(),
      })
    }),
  )

  return router
}

// ---------------------------------------------------------------------------
// 管理侧
// ---------------------------------------------------------------------------

export function createAdminCampaignsRouter(): Router {
  const router = Router()
  router.use(authenticate, requireRole('super_admin'))

  /** 当前活动配置 */
  router.get(
    '/',
    route({}, async ({ res }) => {
      const campaign = await requireCurrentCampaign()
      res.json({
        campaign: toPublicCampaign(campaign),
        tracks: campaign.campaignTracks.map(toPublicTrack),
      })
    }),
  )

  /** 新建活动 */
  router.post(
    '/',
    requireFreshAuth(),
    route({ body: createCampaignBodySchema }, async ({ req, res, body }) => {
      const prisma = getPrismaClient()

      const allTracks = await prisma.track.findMany({ orderBy: { sortOrder: 'asc' } })
      if (allTracks.length === 0) {
        throw new AppError('VALIDATION_FAILED', '尚未初始化赛道，请先运行种子脚本')
      }

      const overrides = new Map((body.tracks ?? []).map((item) => [item.track_id, item]))

      const created = await runInTransaction(prisma, async (tx) => {
        const campaign = await tx.campaign.create({
          data: {
            name: body.name,
            description: body.description ?? null,
            timezone: body.timezone,
            startDate: body.start_date,
            endDate: body.end_date,
            dailyOpenTime: body.daily_open_time,
            dailyDeadline: body.daily_deadline,
            leaderboardVisible: body.leaderboard_visible,
            leaderboardTime: body.leaderboard_time,
            nameDisplayMode: body.name_display_mode,
            minImages: body.min_images,
            maxImages: body.max_images,
            maxImageBytes: body.max_image_bytes,
            allowedMimeTypes: JSON.stringify(body.allowed_mime_types),
            status: 'draft',
            campaignTracks: {
              create: allTracks.map((track) => {
                const override = overrides.get(track.id) ?? overrides.get(track.slug)
                return {
                  trackId: track.id,
                  enabled: override?.enabled ?? true,
                  dailyPoints: override?.daily_points ?? 1000,
                  dailyCap: override?.daily_cap ?? null,
                  campaignCap: override?.campaign_cap ?? null,
                  overallWeight: override?.overall_weight ?? 1000,
                  proofInstructions: override?.proof_instructions ?? null,
                }
              }),
            },
          },
        })

        await recordAudit(
          {
            ...auditContextFrom(req),
            action: 'campaign.create',
            targetType: 'campaign',
            targetId: campaign.id,
            after: { name: body.name, start_date: body.start_date, end_date: body.end_date },
          },
          tx,
        )

        return campaign
      })

      const full = await getCampaignWithTracks(created.id)
      res.status(201).json({
        campaign: toPublicCampaign(full),
        tracks: full.campaignTracks.map(toPublicTrack),
      })
    }),
  )

  /** 更新活动配置 */
  router.put(
    '/',
    requireFreshAuth(),
    route({ body: updateCampaignBodySchema }, async ({ req, res, body }) => {
      const prisma = getPrismaClient()
      const principal = requirePrincipal(req)
      const current = await requireCurrentCampaign()

      const before = {
        name: current.name,
        start_date: current.startDate,
        end_date: current.endDate,
        daily_open_time: current.dailyOpenTime,
        daily_deadline: current.dailyDeadline,
        status: current.status,
        leaderboard_visible: current.leaderboardVisible,
        leaderboard_time: current.leaderboardTime,
        name_display_mode: current.nameDisplayMode,
        min_images: current.minImages,
        max_images: current.maxImages,
        max_image_bytes: current.maxImageBytes,
      }

      const touchedScoringField =
        hasStarted(current.status) &&
        SCORING_FIELDS.some((field) => body[field] !== undefined && body[field] !== before[field])

      const startDate = body.start_date ?? current.startDate
      const endDate = body.end_date ?? current.endDate
      if (startDate > endDate) throw new AppError('VALIDATION_FAILED', '结束日期不能早于开始日期')

      const minImages = body.min_images ?? current.minImages
      const maxImages = body.max_images ?? current.maxImages
      if (minImages > maxImages) throw new AppError('VALIDATION_FAILED', '最少图片数不能大于最多图片数')

      await runInTransaction(prisma, async (tx) => {
        await tx.campaign.update({
          where: { id: current.id },
          data: {
            name: body.name ?? undefined,
            description: body.description === undefined ? undefined : body.description,
            startDate: body.start_date ?? undefined,
            endDate: body.end_date ?? undefined,
            dailyOpenTime: body.daily_open_time ?? undefined,
            dailyDeadline: body.daily_deadline ?? undefined,
            status: body.status ?? undefined,
            leaderboardVisible: body.leaderboard_visible ?? undefined,
            leaderboardTime: body.leaderboard_time ?? undefined,
            nameDisplayMode: body.name_display_mode ?? undefined,
            tieBreakRule: body.tie_break_rule ?? undefined,
            minImages: body.min_images ?? undefined,
            maxImages: body.max_images ?? undefined,
            maxImageBytes: body.max_image_bytes ?? undefined,
            allowedMimeTypes: body.allowed_mime_types ? JSON.stringify(body.allowed_mime_types) : undefined,
          },
        })

        await recordAudit(
          {
            ...auditContextFrom(req),
            action: 'campaign.update',
            targetType: 'campaign',
            targetId: current.id,
            before,
            after: body,
          },
          tx,
        )
      })

      const updated = await getCampaignWithTracks(current.id)
      res.json({
        campaign: toPublicCampaign(updated),
        tracks: updated.campaignTracks.map(toPublicTrack),
        // §8.4：活动开始后修改计分规则属于高风险操作，需要向管理员明确提示影响
        impact_warning: touchedScoringField
          ? '活动已开始，本次修改会影响已有记录的计分与截止判定。已发布的排行榜需要在管理员确认后重新计算。'
          : null,
        actor: principal.userId,
      })
    }),
  )

  /** 更新单个赛道的计分规则 */
  router.put(
    '/tracks/:trackId',
    requireFreshAuth(),
    route({ params: campaignTrackParamsSchema, body: updateCampaignTrackBodySchema }, async ({ req, res, params, body }) => {
      const prisma = getPrismaClient()
      const current = await requireCurrentCampaign()

      const campaignTrack = current.campaignTracks.find(
        (item) => item.trackId === params.trackId || item.track.slug === params.trackId,
      )
      if (!campaignTrack) throw notFound('该赛道未在此活动中启用')

      const before = {
        enabled: campaignTrack.enabled,
        daily_points: campaignTrack.dailyPoints,
        daily_cap: campaignTrack.dailyCap,
        campaign_cap: campaignTrack.campaignCap,
        overall_weight: campaignTrack.overallWeight,
        proof_instructions: campaignTrack.proofInstructions,
      }

      const touchedScoringField =
        hasStarted(current.status) &&
        (body.daily_points !== undefined ||
          body.daily_cap !== undefined ||
          body.campaign_cap !== undefined ||
          body.overall_weight !== undefined ||
          body.enabled !== undefined)

      await runInTransaction(prisma, async (tx) => {
        await tx.campaignTrack.update({
          where: { id: campaignTrack.id },
          data: {
            enabled: body.enabled ?? undefined,
            dailyPoints: body.daily_points ?? undefined,
            dailyCap: body.daily_cap === undefined ? undefined : body.daily_cap,
            campaignCap: body.campaign_cap === undefined ? undefined : body.campaign_cap,
            overallWeight: body.overall_weight ?? undefined,
            proofInstructions: body.proof_instructions === undefined ? undefined : body.proof_instructions,
          },
        })

        await recordAudit(
          {
            ...auditContextFrom(req),
            action: 'campaign.track.update',
            targetType: 'campaign_track',
            targetId: campaignTrack.id,
            before,
            after: body,
          },
          tx,
        )
      })

      const updated = await getCampaignWithTracks(current.id)
      const updatedTrack = updated.campaignTracks.find((item) => item.id === campaignTrack.id)
      res.json({
        track: updatedTrack ? toPublicTrack(updatedTrack) : null,
        impact_warning: touchedScoringField
          ? '活动已开始，修改计分规则会让已有排行榜与最新规则不一致，请在确认后重新计算排行榜。'
          : null,
      })
    }),
  )

  return router
}
