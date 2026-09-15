import { Router } from 'express'
import { notFound } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { getPrismaClient } from '../../db/client.js'
import { assetOnlyParamsSchema, signedAssetQuerySchema } from '../checkins/schema.js'
import { getStorage } from '../../storage/index.js'
import { verifyAssetSignature } from '../../storage/signed-url.js'

/**
 * 凭签名取回图片字节。
 *
 * 这个端点**故意不做会话认证**：`<img src>` 无法携带 Bearer 令牌，
 * 而 design.md §12.2 要求的是「有权限的临时图片地址」——
 * 签名本身就是短期能力凭证，签发端点已经校验过请求者身份。
 * 因此 TTL 保持很短（默认 10 分钟），且签名覆盖 assetId 与过期时间，
 * 改动任何一个字节都会导致校验失败。
 */
export function createAssetsRouter(): Router {
  const router = Router()

  router.get(
    '/:assetId',
    route({ params: assetOnlyParamsSchema, query: signedAssetQuerySchema }, async ({ res, params, query }) => {
      verifyAssetSignature({
        assetId: params.assetId,
        exp: query.exp,
        uid: query.uid,
        sig: query.sig,
      })

      const prisma = getPrismaClient()
      const asset = await prisma.submissionAsset.findUnique({
        where: { id: params.assetId },
        select: { objectKey: true, mimeType: true, size: true },
      })
      if (!asset) throw notFound('图片不存在')

      const buffer = await getStorage().get(asset.objectKey)

      res.setHeader('Content-Type', asset.mimeType)
      res.setHeader('Content-Length', String(buffer.length))
      // 私有缓存：允许浏览器在有效期内复用，但不进共享缓存（design.md §13 要求私有存储）
      res.setHeader('Cache-Control', 'private, max-age=600')
      res.setHeader('Content-Disposition', 'inline')
      res.send(buffer)
    }),
  )

  return router
}
