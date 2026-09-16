import { detectImageTypeFromFile, type DetectedImageType } from '@/lib/imageMagicBytes'
import { zh } from '@/locales/zh-CN'

/**
 * 图片选择的类型与纯函数。
 *
 * 单独成文件而不是和组件放一起：组件文件一旦混入非组件的导出，
 * 热更新就会退化成整页刷新（react-refresh 的限制），
 * 改一行样式都要重新走一遍登录。
 */

export interface SelectedImage {
  /** 稳定标识，用作 React key 与拖拽 id。不能用文件名（可能重名） */
  id: string
  file: File
  /** 预览用的 object URL，卸载或移除时必须 revoke */
  previewUrl: string
}

export interface UploadRules {
  min_images: number
  max_images: number
  max_image_bytes: number
  allowed_mime_types: string[]
}

let idCounter = 0

export function createSelectedImage(file: File): SelectedImage {
  idCounter += 1
  return { id: `img-${idCounter}`, file, previewUrl: URL.createObjectURL(file) }
}

/** 释放不再使用的 object URL，否则手机上反复重选会吃光内存 */
export function releaseSelectedImages(images: SelectedImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.previewUrl)
}

const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}

export function describeRules(rules: UploadRules): string {
  const formats = rules.allowed_mime_types.map((mime) => MIME_LABELS[mime] ?? mime).join('、')
  const mb = Math.round((rules.max_image_bytes / 1024 / 1024) * 10) / 10
  return zh.checkin.submit.uploadRules(rules.min_images, rules.max_images, formats, mb)
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

/**
 * 选图前的校验。
 *
 * 全部在本地先拦一遍：手机上传一张 10MB 的图要几十秒，
 * 等传完再被服务端拒绝是对用户时间的浪费。
 */
export async function validateFile(
  file: File,
  rules: UploadRules,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (file.size > rules.max_image_bytes) {
    const mb = Math.round((rules.max_image_bytes / 1024 / 1024) * 10) / 10
    return { ok: false, reason: zh.checkin.submit.tooLarge(file.name, formatSize(file.size), mb) }
  }

  const detected: DetectedImageType = await detectImageTypeFromFile(file)
  if (!detected) {
    // §7.4：不接受仅修改扩展名的伪装文件
    return { ok: false, reason: zh.checkin.submit.notAnImage(file.name) }
  }
  if (!rules.allowed_mime_types.includes(detected)) {
    return { ok: false, reason: zh.checkin.submit.unsupportedFormat(file.name, detected) }
  }

  return { ok: true }
}
