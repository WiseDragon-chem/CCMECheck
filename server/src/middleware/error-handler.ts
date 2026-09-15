import type { ErrorRequestHandler, RequestHandler } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { ERROR_STATUS, type ErrorCode } from '../config/constants.js'
import { AppError, isAppError } from '../core/errors.js'
import { isBusyError } from '../db/tx.js'
import { Prisma } from '../generated/prisma/client.js'

interface ErrorBody {
  code: ErrorCode
  message: string
  request_id: string
  details: Record<string, unknown>
}

/** design.md §12.5 规定的统一错误响应体 */
function errorBody(code: ErrorCode, message: string, requestId: string, details?: Record<string, unknown>): ErrorBody {
  return { code, message, request_id: requestId, details: details ?? {} }
}

export function zodIssuesToFields(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }))
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `接口不存在：${req.method} ${req.path}`))
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.id ?? 'req_unknown'
  const log = req.log ?? console

  // ---- Zod 校验失败 ----
  if (error instanceof ZodError) {
    const fields = zodIssuesToFields(error)
    log.warn({ fields }, 'validation failed')
    res.status(400).json(
      errorBody('VALIDATION_FAILED', '请求参数校验未通过', requestId, { fields }),
    )
    return
  }

  // ---- 业务错误 ----
  if (isAppError(error)) {
    const level = error.status >= 500 ? 'error' : 'warn'
    log[level]({ code: error.code, status: error.status }, error.message)
    res.status(error.status).json(errorBody(error.code, error.message, requestId, error.details))
    return
  }

  // ---- 上传体积/数量超限 ----
  if (error instanceof MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? '单张图片超出大小限制'
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? '上传的图片数量超出限制'
          : '上传的文件不合法'
    log.warn({ multer_code: error.code }, message)
    res.status(400).json(errorBody('UPLOAD_INVALID', message, requestId, { multer_code: error.code }))
    return
  }

  // ---- Prisma 已知错误 ----
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      log.warn({ prisma_code: error.code, target: error.meta?.target }, 'unique constraint violated')
      res
        .status(409)
        .json(
          errorBody('DUPLICATE_RECORD', '该记录已存在，请勿重复提交', requestId, {
            target: error.meta?.target ?? null,
          }),
        )
      return
    }
    if (error.code === 'P2025') {
      res.status(404).json(errorBody('NOT_FOUND', '资源不存在', requestId))
      return
    }
    if (error.code === 'P2003') {
      log.warn({ prisma_code: error.code }, 'foreign key constraint violated')
      res.status(400).json(errorBody('BAD_REQUEST', '关联数据不存在', requestId))
      return
    }
  }

  // ---- 写锁争用：重试已在 db/tx.ts 内做过，走到这里说明持续拥塞 ----
  if (isBusyError(error)) {
    log.error({ err: error }, 'database busy after retries')
    res
      .status(503)
      .json(errorBody('INTERNAL_ERROR', '数据库繁忙，请稍后重试', requestId))
    return
  }

  // ---- 未知异常：记录完整堆栈，只向客户端返回泛化信息 ----
  log.error({ err: error }, 'unhandled error')
  res
    .status(ERROR_STATUS.INTERNAL_ERROR)
    .json(
      errorBody(
        'INTERNAL_ERROR',
        '服务器内部错误',
        requestId,
        env.isProduction ? {} : { hint: error instanceof Error ? error.message : String(error) },
      ),
    )
}
