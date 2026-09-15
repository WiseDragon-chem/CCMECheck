import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger, stripSensitiveQuery } from '../core/logger.js'

const REQUEST_ID_HEADER = 'x-request-id'
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/

/**
 * 为每个请求分配 request_id，并绑定一个子日志器。
 * request_id 同时出现在响应头、日志和错误响应体中（design.md §12.5）。
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER)
  const requestId =
    incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`

  req.id = requestId
  res.setHeader('X-Request-Id', requestId)

  req.log = logger.child({ request_id: requestId })
  next()
}

/**
 * 访问日志。刻意不直接使用 pino-http 的默认序列化器：
 * 默认实现会把完整 URL（含签名参数）写进日志，而签名地址本身就是能力凭证。
 */
export function accessLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint()

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'

    req.log[level](
      {
        method: req.method,
        url: stripSensitiveQuery(req.originalUrl),
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        user_id: req.principal?.userId,
      },
      'request',
    )
  })

  next()
}
