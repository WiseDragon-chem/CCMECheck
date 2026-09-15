import { Router } from 'express'
import { AppError, notFound } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { uploadImages, uploadedImages } from '../../middleware/upload.js'
import { signAssetUrl } from '../../storage/signed-url.js'
import {
  assetParamsSchema,
  checkinEntryParamsSchema,
  listCheckinsQuerySchema,
  submitCheckinFieldsSchema,
} from './schema.js'
import { getCheckinDetail, getTodayOverview, listCheckins, submitCheckin } from './service.js'

export function createCheckinsRouter(): Router {
  const router = Router()
  router.use(authenticate)

  /** 今日三个赛道的卡片状态（design.md §7.3） */
  router.get(
    '/today',
    route({}, async ({ req, res }) => {
      const principal = requirePrincipal(req)
      res.json(await getTodayOverview(principal))
    }),
  )

  /** 个人打卡记录（design.md §7.5） */
  router.get(
    '/',
    route({ query: listCheckinsQuerySchema }, async ({ req, res, query }) => {
      const principal = requirePrincipal(req)
      res.json(await listCheckins(principal, query))
    }),
  )

  /** 打卡详情与历史版本 */
  router.get(
    '/:entryId',
    route({ params: checkinEntryParamsSchema }, async ({ req, res, params }) => {
      const principal = requirePrincipal(req)
      res.json(await getCheckinDetail(principal, params.entryId))
    }),
  )

  /** 创建或重新提交打卡（design.md §7.4） */
  router.post(
    '/',
    // multer 必须在 route() 之前跑：multipart 的文本字段由它填进 req.body
    uploadImages,
    route({ body: submitCheckinFieldsSchema }, async ({ req, res, body }) => {
      const principal = requirePrincipal(req)
      const result = await submitCheckin({
        principal,
        fields: body,
        files: uploadedImages(req),
      })
      res.status(201).json(result)
    }),
  )

  /**
   * 签发临时图片地址（design.md §12.2）。
   *
   * 签发前校验请求者身份：参赛者只能拿自己的材料，审核员与超管可拿全部（§13）。
   */
  router.get(
    '/:entryId/assets/:assetId',
    route({ params: assetParamsSchema }, async ({ req, res, params }) => {
      const principal = requirePrincipal(req)
      const prisma = getPrismaClient()

      const asset = await prisma.submissionAsset.findUnique({
        where: { id: params.assetId },
        select: {
          id: true,
          revision: {
            select: {
              entryId: true,
              entry: { select: { participant: { select: { userId: true } } } },
            },
          },
        },
      })

      if (!asset || asset.revision.entryId !== params.entryId) throw notFound('图片不存在')

      const ownerUserId = asset.revision.entry.participant.userId
      const isOwner = ownerUserId === principal.userId
      const isReviewer = principal.role === 'reviewer' || principal.role === 'super_admin'
      if (!isOwner && !isReviewer) {
        throw new AppError('NOT_ENTRY_OWNER', '只能查看自己的证明材料')
      }

      res.json(signAssetUrl({ assetId: asset.id, userId: principal.userId }))
    }),
  )

  return router
}
