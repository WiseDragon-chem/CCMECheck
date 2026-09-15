import multer from 'multer'
import { AppError } from '../core/errors.js'

/**
 * 上传接收。
 *
 * 用 memoryStorage：图片需要先经过 sharp 解码校验与 EXIF 剥离才能落盘，
 * 而且单次最多 3×10MB，放内存里完全可以接受，还省掉了临时文件清理。
 *
 * 这里的限制是**全局上限**，用于挡住明显恶意的请求；
 * 活动级的具体限制（图片数量、单张大小、允许格式）在 service 层按活动配置校验，
 * 因为那些值是管理员可改的，不能固化在中间件里。
 */

export const UPLOAD_HARD_MAX_FILES = 9
export const UPLOAD_HARD_MAX_BYTES = 50 * 1024 * 1024

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

export const uploadSingleCsv = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 16 },
}).single('file')

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
