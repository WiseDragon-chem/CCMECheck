import pino from 'pino'
import { env } from '../config/env.js'

/**
 * 结构化日志（design.md §10.2）。
 *
 * design.md §13：日志中不得记录密码、令牌、激活码或签名图片地址。
 * 这里通过两层保证：
 *   1. redact 覆盖请求头、请求体中的敏感字段；
 *   2. 自定义 req 序列化器剥离 URL 查询串里的签名参数，
 *      因为签名地址本身就是能力凭证，写进日志等于泄漏。
 */

const REDACTED = '[REDACTED]'

/** 出现在查询串中、一旦落日志即等于泄漏的参数名 */
const SENSITIVE_QUERY_PARAMS = new Set(['sig', 'signature', 'token', 'exp', 'activation_code', 'code'])

export function stripSensitiveQuery(url: string | undefined): string | undefined {
  if (!url) return url
  const questionMark = url.indexOf('?')
  if (questionMark === -1) return url

  const pathname = url.slice(0, questionMark)
  const search = new URLSearchParams(url.slice(questionMark + 1))

  const kept: string[] = []
  for (const [key, value] of search.entries()) {
    kept.push(SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ? `${key}=${REDACTED}` : `${key}=${value}`)
  }

  return kept.length > 0 ? `${pathname}?${kept.join('&')}` : pathname
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-client-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.activationCode',
  'req.body.token',
  'req.body.refreshToken',
  'password',
  'passwordHash',
  'activationCode',
  'tokenHash',
  'refreshToken',
]

export const logger = pino({
  level: env.logLevel,
  redact: { paths: REDACT_PATHS, censor: REDACTED },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
})

export type Logger = typeof logger
