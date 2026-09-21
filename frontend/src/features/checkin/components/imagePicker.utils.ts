import {
  COMPRESS_TARGET_BYTES,
  MAX_INPUT_BYTES,
  compressToTarget,
  type CompressDeps,
} from '@/lib/imageCompress'
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
  return zh.checkin.submit.uploadRules(
    rules.min_images,
    rules.max_images,
    formats,
    formatSize(rules.max_image_bytes),
  )
}

/** 640 KB 这样的限额写成「0.6 MB」反而看不清，所以小于 1MB 时按 KB 显示 */
export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

/**
 * 按内容与活动配置校验**原文件**。
 *
 * 只管是不是真图片、格式活动收不收 —— **不管大小**。大小要到压缩之后
 * 才算数：一张 5MB 的手机照片本该能压下来，用原文件大小拦它等于把
 * 这个功能关掉。见 prepareImage。
 */
export async function validateFile(
  file: File,
  rules: UploadRules,
): Promise<{ ok: true } | { ok: false; reason: string }> {
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

/** 单张大小上限。查的是压缩产物 —— 这是服务端真正会拒的那个字节数 */
export function checkSize(
  file: File,
  rules: UploadRules,
): { ok: true } | { ok: false; reason: string } {
  if (file.size > rules.max_image_bytes) {
    return {
      ok: false,
      reason: zh.checkin.submit.tooLargeAfterCompress(
        file.name,
        formatSize(file.size),
        formatSize(rules.max_image_bytes),
      ),
    }
  }
  return { ok: true }
}

/**
 * 选图后的完整处理：校验内容 → 按需压缩 → 校验大小。
 *
 * 压缩放在本地而不是等服务端，是为了让用户在**上传之前**就看到结果 ——
 * 手机上传一张 10MB 的图要几十秒，等传完再被拒绝是对用户时间的浪费。
 *
 * `deps` 只是给单测注入假 canvas 用的，生产路径不必传。
 */
export async function prepareImage(
  file: File,
  rules: UploadRules,
  deps?: CompressDeps,
): Promise<{ ok: true; file: File } | { ok: false; reason: string }> {
  const valid = await validateFile(file, rules)
  if (!valid.ok) return valid

  // 大到连解码都不敢试。手机内存有限，硬解会把标签页拖垮
  if (file.size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      reason: zh.checkin.submit.tooLargeToProcess(file.name, formatSize(file.size)),
    }
  }

  /*
    阈值取产品的 600KB 与活动配置的较小者：活动若把上限配成 512KB，
    压到 600KB 仍然会被拒 —— 这个 min 让前端的目标与后端的判据天然一致。
  */
  const target = Math.min(COMPRESS_TARGET_BYTES, rules.max_image_bytes)

  let prepared = file
  if (file.size > target) {
    try {
      prepared = await compressToTarget(file, target, deps)
    } catch {
      // 解码或编码失败。能走到这里的文件已经过了魔数校验，
      // 所以基本等同于文件损坏 —— 服务端的 failOn: 'error' 同样会拒
      return { ok: false, reason: zh.checkin.submit.cannotProcess(file.name) }
    }
  }

  const withinLimit = checkSize(prepared, rules)
  if (!withinLimit.ok) return withinLimit

  return { ok: true, file: prepared }
}
