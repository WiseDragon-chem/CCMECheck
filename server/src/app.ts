import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env.js'
import { logger } from './core/logger.js'
import { registerApiRoutes } from './routes.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { accessLogger, requestContext } from './middleware/request-context.js'

export function createApp(): Express {
  const app = express()

  // 部署在反向代理后，限流需要真实客户端 IP
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(requestContext)
  app.use(accessLogger)

  app.use(
    helmet({
      // 证明材料通过 API 域提供给前端页面，默认的 same-origin 策略会拦掉 <img>
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  )

  app.use(
    cors({
      origin(origin, callback) {
        // 同源请求或非浏览器客户端没有 Origin 头
        if (!origin) return callback(null, true)
        if (env.corsOrigins.includes(origin)) return callback(null, true)
        callback(new Error(`来源不在 CORS 白名单中：${origin}`))
      },
      credentials: true,
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  app.use('/api/v1', registerApiRoutes())

  app.use(notFoundHandler)
  app.use(errorHandler)

  logger.debug({ cors_origins: env.corsOrigins }, 'express app assembled')
  return app
}
