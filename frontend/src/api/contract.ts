import type { paths } from '@/types/api'

/**
 * 从生成的 OpenAPI 契约里抽取请求体与响应体的类型。
 *
 * 各 endpoint 模块必须用这些工具取类型，**不许手写请求体** ——
 * 手写就会漏掉像认证接口字段名那样的细节，而且不会有人发现。
 */

type Methods = 'get' | 'post' | 'put' | 'patch' | 'delete'

type Operation<P extends keyof paths, M extends Methods> = P extends keyof paths
  ? M extends keyof paths[P]
    ? paths[P][M]
    : never
  : never

/**
 * 注意模式里 `requestBody` 与 `content` 前面的问号。
 *
 * 契约里它们都是**可选**属性（GET 没有请求体、某些响应没有 body），
 * 而条件类型按「必需属性」匹配时，可选属性不满足，结果会静默退化成 never ——
 * 报错现场是「这个参数不能赋给 never」，很难看出真正的原因。
 */
export type JsonBody<P extends keyof paths, M extends Methods> = Operation<P, M> extends {
  requestBody?: { content: { 'application/json'?: infer B } }
}
  ? NonNullable<B>
  : never

export type FormBody<P extends keyof paths, M extends Methods> = Operation<P, M> extends {
  requestBody?: { content: { 'multipart/form-data'?: infer B } }
}
  ? NonNullable<B>
  : never

/** 成功响应的 JSON 体类型。契约里 200 与 201 都用得到。 */
export type JsonOk<P extends keyof paths, M extends Methods> = Operation<P, M> extends {
  responses: { 200: { content: { 'application/json'?: infer R } } }
}
  ? NonNullable<R>
  : Operation<P, M> extends { responses: { 201: { content: { 'application/json'?: infer R } } } }
    ? NonNullable<R>
    : never

/** query 参数类型 */
export type QueryOf<P extends keyof paths, M extends Methods> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never
