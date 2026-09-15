import { Router, type RequestHandler } from 'express'
import multer, { MulterError } from 'multer'
import { AppError, validationFailed } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { paginationToSkipTake } from '../../core/validation.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { requireRole } from '../../middleware/authorize.js'
import { auditContextFrom } from '../../services/audit.service.js'
import {
  createParticipantBodySchema,
  importCommitBodySchema,
  listParticipantsQuerySchema,
  participantParamsSchema,
  updateParticipantStatusBodySchema,
} from './schema.js'
import * as participantsService from './service.js'

/**
 * 名单管理（design.md §7.1、§8.3）。
 *
 * §5 的权限矩阵里只有超级管理员能导入名单和管理账号，
 * 因此整个 router 统一挂 requireRole('super_admin')，不在单个路由上重复声明。
 */

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: participantsService.CSV_MAX_BYTES, files: 1 },
}).single('file')

/**
 * 包一层 multer，把 MulterError 翻成业务错误。
 * error-handler 里的兜底文案是按图片写的（「单张图片超出大小限制」），
 * 名单导入面向的是 CSV，需要更准确的中文提示。
 */
const csvUpload: RequestHandler = (req, res, next) => {
  uploadCsv(req, res, (error: unknown) => {
    if (!error) return next()
    if (error instanceof MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `CSV 文件不能超过 ${Math.floor(participantsService.CSV_MAX_BYTES / 1024 / 1024)} MB`
          : error.code === 'LIMIT_UNEXPECTED_FILE'
            ? '表单字段名必须是 file，且一次只能上传一个文件'
            : 'CSV 文件上传失败'
      return next(new AppError('UPLOAD_INVALID', message, { details: { multer_code: error.code } }))
    }
    next(error)
  })
}

export function createAdminParticipantsRouter(): Router {
  const router = Router()

  router.use(authenticate, requireRole('super_admin'))

  // ---- CSV 模板 ----
  router.get(
    '/template.csv',
    route({}, async ({ res }) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="participants-template.csv"')
      res.send(participantsService.buildTemplateCsv())
    }),
  )

  // ---- 激活码状态导出 ----
  router.get(
    '/activation-codes.csv',
    route({}, async ({ res }) => {
      const csv = await participantsService.buildActivationCodesCsv()
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="activation-codes.csv"')
      res.send(csv)
    }),
  )

  // ---- 导入：预览 ----
  router.post(
    '/import/preview',
    csvUpload,
    route({}, async ({ req, res }) => {
      requirePrincipal(req)
      const file = req.file
      if (!file) throw validationFailed('请上传 CSV 文件（表单字段名 file）')

      const result = await participantsService.previewImport({
        buffer: file.buffer,
        fileName: file.originalname || null,
        actor: auditContextFrom(req),
      })
      res.status(201).json(result)
    }),
  )

  // ---- 导入：正式写入 ----
  router.post(
    '/import/commit',
    route({ body: importCommitBodySchema }, async ({ req, res, body }) => {
      requirePrincipal(req)
      const result = await participantsService.commitImport({
        batchId: body.batch_id,
        actor: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  // ---- 名单列表 ----
  router.get(
    '/',
    route({ query: listParticipantsQuerySchema }, async ({ res, query }) => {
      const { skip, take } = paginationToSkipTake(query)
      const result = await participantsService.listParticipants({
        status: query.status,
        className: query.class_name,
        keyword: query.keyword,
        skip,
        take,
      })
      res.json({
        items: result.items,
        total: result.total,
        page: query.page,
        page_size: query.page_size,
      })
    }),
  )

  // ---- 添加单个参赛者 ----
  router.post(
    '/',
    route({ body: createParticipantBodySchema }, async ({ req, res, body }) => {
      requirePrincipal(req)
      const result = await participantsService.createParticipant({
        studentId: body.student_id,
        name: body.name,
        className: body.class_name ?? null,
        phoneSuffix: body.phone_suffix ?? null,
        remark: body.remark ?? null,
        actor: auditContextFrom(req),
      })
      // 激活码明文只在这里出现一次，之后库里只有哈希（§13）
      res.status(201).json(result)
    }),
  )

  // ---- 启用 / 禁用 ----
  router.patch(
    '/:participantId',
    route(
      { params: participantParamsSchema, body: updateParticipantStatusBodySchema },
      async ({ req, res, params, body }) => {
        requirePrincipal(req)
        const result = await participantsService.updateParticipantStatus({
          participantId: params.participantId,
          status: body.status,
          actor: auditContextFrom(req),
        })
        res.json(result)
      },
    ),
  )

  // ---- 重新生成激活码 ----
  router.post(
    '/:participantId/activation-code',
    route({ params: participantParamsSchema }, async ({ req, res, params }) => {
      requirePrincipal(req)
      const result = await participantsService.regenerateActivationCode({
        participantId: params.participantId,
        actor: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  // ---- 重置密码 ----
  router.post(
    '/:participantId/reset-password',
    route({ params: participantParamsSchema }, async ({ req, res, params }) => {
      requirePrincipal(req)
      const result = await participantsService.resetParticipantPassword({
        participantId: params.participantId,
        actor: auditContextFrom(req),
      })
      res.json(result)
    }),
  )

  return router
}
