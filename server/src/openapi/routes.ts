import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { env } from '../config/env.js'
import { buildOpenApiDocument } from './document.js'

/**
 * 对外暴露 OpenAPI 文档。
 *
 * 文档在模块加载时构建一次 —— 它完全由静态 schema 推导，不依赖数据库，
 * 每个请求重新生成纯属浪费。前端据此生成类型。
 */
export function createOpenApiRouter(): Router {
  const router = Router()
  const document = buildOpenApiDocument()

  router.get('/openapi.json', (_req, res) => {
    res.json(document)
  })

  // Swagger UI 只在非生产环境挂载：它会加载外部 CDN 资源，
  // 在生产暴露既有内容安全策略上的顾虑，也不是给终端用户看的
  if (!env.isProduction) {
    router.use('/docs', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'CCME 打卡平台 API' }))
  }

  return router
}
