import { env } from '../config/env.js'
import { SIGNED_URL_TTL_SECONDS } from '../config/constants.js'
import { AppError } from '../core/errors.js'
import { verifyHmacSha256, hmacSha256Base64Url } from '../core/crypto.js'

/**
 * 证明材料访问使用短期签名地址（design.md §13）。
 *
 * 签名主体是 (asset_id, exp, uid) 三段拼接。
 * 这里用 asset_id 而不是对象键：对象键带路径分隔符，塞进 URL 路径段还需要额外编码，
 * 而 asset_id 是不透明的 cuid，既没有分隔符问题，也不泄漏存储布局。
 *
 * 签名地址本身就是能力凭证 —— 谁拿到都能在有效期内访问，
 * 因此 TTL 保持很短，且签发前必须校验请求者的访问权限。
 */

export interface SignedAssetUrl {
  url: string
  expires_at: string
  expires_in: number
}

interface SignatureInput {
  assetId: string
  expiresAtEpoch: number
  userId: string
}

function payloadOf(input: SignatureInput): string {
  return `${input.assetId}.${input.expiresAtEpoch}.${input.userId}`
}

function computeSignature(input: SignatureInput): string {
  return hmacSha256Base64Url(payloadOf(input), env.fileSigningSecret)
}

export function signAssetUrl(params: {
  assetId: string
  /** 签名绑定的用户，仅用于审计追溯与日志关联 */
  userId: string
  ttlSeconds?: number
}): SignedAssetUrl {
  const ttl = params.ttlSeconds ?? SIGNED_URL_TTL_SECONDS
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttl

  const signature = computeSignature({
    assetId: params.assetId,
    expiresAtEpoch,
    userId: params.userId,
  })

  const query = new URLSearchParams({
    exp: String(expiresAtEpoch),
    uid: params.userId,
    sig: signature,
  })

  return {
    url: `${env.publicBaseUrl}/api/v1/assets/${encodeURIComponent(params.assetId)}?${query.toString()}`,
    expires_at: new Date(expiresAtEpoch * 1000).toISOString(),
    expires_in: ttl,
  }
}

export interface VerifyResult {
  assetId: string
  userId: string
}

/** 校验签名与时效，失败时抛出 AppError */
export function verifyAssetSignature(params: {
  assetId: string
  exp: string | undefined
  uid: string | undefined
  sig: string | undefined
}): VerifyResult {
  const { assetId, exp, uid, sig } = params

  if (!exp || !uid || !sig) {
    throw new AppError('SIGNATURE_INVALID', '图片地址缺少签名参数')
  }

  const expiresAtEpoch = Number(exp)
  if (!Number.isInteger(expiresAtEpoch)) {
    throw new AppError('SIGNATURE_INVALID', '图片地址签名不合法')
  }

  if (!verifyHmacSha256(payloadOf({ assetId, expiresAtEpoch, userId: uid }), sig, env.fileSigningSecret)) {
    throw new AppError('SIGNATURE_INVALID', '图片地址签名校验失败')
  }

  if (expiresAtEpoch * 1000 < Date.now()) {
    throw new AppError('SIGNATURE_INVALID', '图片地址已过期，请刷新页面')
  }

  return { assetId, userId: uid }
}
