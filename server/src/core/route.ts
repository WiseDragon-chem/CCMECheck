import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodType } from 'zod'

/**
 * 类型安全的「校验 + 处理」路由包装。
 *
 * Express 5 把 req.query 定义成原型上的 getter，直接赋值会抛错，
 * 所以这里用自有属性遮蔽它，handler 里就能像平常一样读 req.query / req.body，
 * 且类型是 Zod 推导出来的（design.md §10.2 要求用 Zod 做请求校验）。
 */

type InferSchema<S> = S extends ZodType<infer Output> ? Output : undefined

export interface RouteSchemas {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

export interface RouteContext<S extends RouteSchemas> {
  req: Request
  res: Response
  next: NextFunction
  body: InferSchema<S['body']>
  query: InferSchema<S['query']>
  params: InferSchema<S['params']>
}

/** 遮蔽 Express 原型上的 getter，让后续读取拿到校验后的值 */
function shadowProperty(req: Request, key: 'body' | 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

export function route<S extends RouteSchemas>(
  schemas: S,
  handler: (ctx: RouteContext<S>) => Promise<void> | void,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = schemas.body ? schemas.body.parse(req.body) : undefined
      const query = schemas.query ? schemas.query.parse(req.query) : undefined
      const params = schemas.params ? schemas.params.parse(req.params) : undefined

      if (schemas.body) shadowProperty(req, 'body', body)
      if (schemas.query) shadowProperty(req, 'query', query)
      if (schemas.params) shadowProperty(req, 'params', params)

      await handler({ req, res, next, body, query, params } as RouteContext<S>)
    } catch (error) {
      // Express 5 也会转发被拒绝的 promise，这里显式 catch 只是为了尽早交接
      next(error)
    }
  }
}
