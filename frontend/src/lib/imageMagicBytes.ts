/**
 * 按文件内容识别图片格式。
 *
 * design.md §7.4 明确要求「不接受仅修改扩展名的伪装文件」。
 * 后端会按内容识别并拒绝，但客户端先拦一道能省掉整整一次上传往返 ——
 * 在手机上那是几十秒的事。
 *
 * 注意：客户端检查只是提前反馈，**不是安全边界**。真正的判定在后端。
 */

export type DetectedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | null

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

export function detectImageType(bytes: Uint8Array): DetectedImageType {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // PNG 有 8 字节固定签名
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'

  // WebP 是 RIFF 容器：'RIFF' + 4 字节长度 + 'WEBP'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'

  return null
}

/** 只需要文件头几个字节就能判断 */
export async function detectImageTypeFromFile(file: File): Promise<DetectedImageType> {
  const head = await file.slice(0, 16).arrayBuffer()
  return detectImageType(new Uint8Array(head))
}
