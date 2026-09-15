import sharp from 'sharp'
import type { Metadata, OutputInfo } from 'sharp'
import { MAX_IMAGE_PIXELS } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import { sha256Hex } from '../core/crypto.js'

/**
 * 证明材料图片处理流水线（design.md §13）。
 *
 * 关键点：
 *   * 格式按文件内容识别，不信任扩展名与客户端声明的 Content-Type；
 *   * 必须能被成功解码才接受，无法解码的直接拒绝（挡掉伪装成图片的文本）；
 *   * 重新编码一次，自然丢弃 EXIF（含地理位置与设备信息）；
 *   * 限制像素总量，防御解压炸弹。
 */

const SHARP_FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export interface ProcessedImage {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  size: number
  sha256: string
}

export async function processImage(input: Buffer, allowedMimeTypes: readonly string[]): Promise<ProcessedImage> {
  // ---- 1. 按内容识别真实格式 ----
  let metadata: Metadata
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata()
  } catch (error) {
    throw new AppError('UPLOAD_INVALID', '无法识别的图片文件', { cause: error })
  }

  const detectedFormat = metadata.format
  if (!detectedFormat) {
    throw new AppError('UPLOAD_INVALID', '无法识别的图片格式')
  }

  const mimeType = SHARP_FORMAT_TO_MIME[detectedFormat]
  if (!mimeType) {
    throw new AppError('UPLOAD_INVALID', `不支持的图片格式：${detectedFormat}，仅支持 JPEG、PNG、WebP`)
  }
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new AppError('UPLOAD_INVALID', `当前活动不接受 ${mimeType} 格式的图片`)
  }

  // ---- 2. 解码后重新编码，剥离 EXIF ----
  // rotate() 不带参数表示按 EXIF 的 Orientation 自动摆正，避免手机竖拍图片在审核页横躺
  let output: { data: Buffer; info: OutputInfo }
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).rotate()

    switch (detectedFormat) {
      case 'jpeg':
        output = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        break
      case 'png':
        output = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        break
      default:
        output = await pipeline.webp({ quality: 88 }).toBuffer({ resolveWithObject: true })
        break
    }
  } catch (error) {
    throw new AppError('UPLOAD_INVALID', '图片处理失败，文件可能已损坏', { cause: error })
  }

  const { data, info } = output
  if (info.width === 0 || info.height === 0) {
    throw new AppError('UPLOAD_INVALID', '图片尺寸不合法')
  }

  return {
    buffer: data,
    mimeType,
    width: info.width,
    height: info.height,
    size: info.size,
    // 摘要是对「处理后的内容」计算的，用于提示疑似重复证明（§13）
    sha256: sha256Hex(data),
  }
}
