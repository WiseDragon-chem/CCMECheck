import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 摘要、随机标识与 HMAC 签名。
 *
 * design.md §13：激活码与刷新令牌只保存哈希；对象键使用随机标识，
 * 不能包含姓名或学号；图片访问使用短期签名地址。
 */

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 高熵随机串，用于激活码、刷新令牌等一次性凭证 */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/** 6 位十六进制随机分片，用于生成便于人工转述的激活码 */
export function randomCode(byteLength = 5): string {
  return randomBytes(byteLength).toString('hex').toUpperCase()
}

const OBJECT_KEY_SHARD_LENGTH = 2

/**
 * 生成对象键：<前两位分片>/<随机串>。
 * 刻意不含任何用户标识 —— 对象键一旦泄漏也不暴露学号或姓名（design.md §13）。
 */
export function randomObjectKey(byteLength = 24): string {
  const raw = randomBytes(byteLength).toString('hex')
  const shard = raw.slice(0, OBJECT_KEY_SHARD_LENGTH)
  return `${shard}/${raw.slice(OBJECT_KEY_SHARD_LENGTH)}`
}

/** 定长比较，避免签名比对被计时侧信道利用 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function hmacSha256Base64Url(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function verifyHmacSha256(data: string, signature: string, secret: string): boolean {
  return constantTimeEqual(hmacSha256Base64Url(data, secret), signature)
}
