import type { Request, RequestHandler } from 'express'
import multer from 'multer'
import { AppError } from '../core/errors.js'
import { formatBytes } from '../core/text.js'

/**
 * 上传接收。
 *
 * 用 memoryStorage：图片需要先经过 sharp 解码校验与 EXIF 剥离才能落盘，
 * 而活动级限额（默认 3 张 × 640KB）放内存里完全可以接受，还省掉了临时文件清理。
 *
 * 限额分三层，各司其职：
 *   1. uploadBudgetGuard —— 读请求体**之前**按活动配置预检 Content-Length，
 *      挡住「诚实但超预算」的请求（例如一次选了 30 张照片）；
 *   2. 本文件的 multer limits —— 全局硬上限，兜住任何客户端；
 *   3. checkins/service.ts 的 assertFilesWithinRules —— 解码之后再核一次，
 *      因为活动配置是管理员可改的，不能固化在中间件里。
 */

export const UPLOAD_HARD_MAX_FILES = 9
export const UPLOAD_HARD_MAX_BYTES = 50 * 1024 * 1024

/**
 * multipart 编码本身的余量：每个 part 的头约 200 字节，
 * 文本字段（note / client_token / track / activity_date / word_count / exercise_type）
 * 合计不到 2KB —— 64KiB 有二十倍以上富余。
 */
export const UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export interface UploadBudget {
  maxImages: number
  maxImageBytes: number
}

/** 该活动允许的请求体上限：图片总量 + 表单余量 */
export function uploadBudgetBytes(budget: UploadBudget): number {
  return budget.maxImages * budget.maxImageBytes + UPLOAD_MULTIPART_OVERHEAD_BYTES
}

/**
 * 拒绝上传请求前，等调用方把请求体发完（读到就丢，不缓冲）。
 *
 * 为什么必须等：在调用方仍在写请求体的时候关闭连接，TCP 会用 RST 回应后续到达的数据，
 * 而 RST 会连带丢弃客户端接收缓冲里**已经收到的错误响应** ——
 * 于是「最多 3 张」这句提示到不了用户眼前，浏览器只会报连接被重置。
 * 等的上限是 REJECT_DRAIN_TIMEOUT_MS：对方不再发数据（或本就是恶意慢速上传）时不再等，
 * 直接回响应并让连接结束。
 */
const REJECT_DRAIN_TIMEOUT_MS = 3000

function drainRequestBody(req: Request): Promise<void> {
  if (req.readableEnded) return Promise.resolve()

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined
    const finish = (): void => {
      if (timer) clearTimeout(timer)
      req.off('end', finish)
      req.off('close', finish)
      req.off('error', finish)
      resolve()
    }

    timer = setTimeout(finish, REJECT_DRAIN_TIMEOUT_MS)
    req.on('end', finish)
    req.on('close', finish)
    req.on('error', finish)
    req.resume()
  })
}

/**
 * 按活动限额预检请求体大小。
 *
 * 必须挂在 multer **之前**：memoryStorage 会把整个请求体读进内存，而活动级限额
 * 要到解码之后才校验 —— 那时内存已经花掉了（9 × 50MiB 的上限就是 450MiB）。
 * 这道闸只看 Content-Length，一个字节都不读。
 *
 * 预算通过工厂注入（而不是直接 import 活动服务），保持中间件层不反向依赖模块层。
 */
export function createUploadBudgetGuard(loadBudget: () => Promise<UploadBudget>): RequestHandler {
  return async (req, _res, next) => {
    try {
      const contentType = req.header('content-type') ?? ''
      // 非 multipart 请求与上传无关（图片走 multipart，CSV 导入另有自己的限制）
      if (!contentType.startsWith('multipart/form-data')) return next()

      const declared = req.header('content-length')
      if (declared === undefined) {
        // 分块传输没有长度可查：放行到 multer 的全局硬上限，由限流器兜住并发
        req.log?.warn(
          { url: req.originalUrl, user_id: req.principal?.userId },
          '上传请求缺少 Content-Length，无法按活动限额预检',
        )
        return next()
      }

      const declaredBytes = Number(declared)
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
        throw new AppError('UPLOAD_INVALID', 'Content-Length 不是合法的字节数')
      }

      const budget = await loadBudget()
      const limitBytes = uploadBudgetBytes(budget)
      if (declaredBytes > limitBytes) {
        throw new AppError(
          'UPLOAD_INVALID',
          `上传体积超出当前活动的限制（最多 ${budget.maxImages} 张、单张不超过 ${formatBytes(budget.maxImageBytes)}）`,
          { details: { limit_bytes: limitBytes, content_length: declaredBytes } },
        )
      }

      next()
    } catch (error) {
      // 先把调用方已经发出去的请求体收完，再回错误响应 ——
      // 否则大一点的上传（超过 socket 缓冲）会以 RST 收场，用户看不到这句提示。
      // 重复滥用由上面的限流器兜住。
      await drainRequestBody(req)
      next(error)
    }
  }
}

const memoryStorage = multer.memoryStorage()

export const uploadImages = multer({
  storage: memoryStorage,
  limits: {
    fileSize: UPLOAD_HARD_MAX_BYTES,
    files: UPLOAD_HARD_MAX_FILES,
    fields: 32,
  },
  fileFilter(_req, file, callback) {
    // 只做粗筛；真实格式以后端按文件内容识别为准（design.md §13），
    // 客户端声明的 Content-Type 与扩展名都不可信
    if (!file.mimetype.startsWith('image/')) {
      callback(new AppError('UPLOAD_INVALID', '只能上传图片文件'))
      return
    }
    callback(null, true)
  },
}).array('images', UPLOAD_HARD_MAX_FILES)

export interface UploadedFile {
  fieldname: string
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

/** 取出本次请求的图片，按上传顺序排列 */
export function uploadedImages(req: { files?: unknown }): UploadedFile[] {
  const files = req.files
  if (!Array.isArray(files)) return []
  return files as UploadedFile[]
}
