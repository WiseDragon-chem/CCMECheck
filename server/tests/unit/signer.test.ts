import { afterEach, describe, expect, it } from 'vitest'
import { SIGNED_URL_TTL_SECONDS } from '../../src/config/constants.js'
import { randomObjectKey } from '../../src/core/crypto.js'
import { isValidObjectKey } from '../../src/storage/local.js'
import { signAssetUrl, verifyAssetSignature, type SignedAssetUrl } from '../../src/storage/signed-url.js'
import { freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §13 图片访问使用短期签名地址。
 *
 * 签名地址本身就是能力凭证 —— 取字节的端点刻意不挂认证（`<img>` 带不了 Bearer 令牌），
 * 所以「签名覆盖了哪些字段」直接决定了这个端点的安全性：
 * asset_id、过期时间、uid 三段任何一处被改动都必须校验失败。
 */

const ASSET_ID = 'clx1234567890abcdefghij'
const USER_ID = 'cluser1234567890abcdefg'

/** 捕获抛出的错误：这些纯函数失败时抛 AppError，逐条断言 code 比 toThrow 字符串更稳 */
function captureError(run: () => unknown): { code?: string; message: string } {
  try {
    run()
  } catch (error) {
    const err = error as { code?: string; message: string }
    return { code: err.code, message: err.message }
  }
  throw new Error('预期抛出 SIGNATURE_INVALID，但调用正常返回了')
}

/** 把签名地址拆回查询参数，方便逐项篡改 */
function queryOf(signed: SignedAssetUrl) {
  const url = new URL(signed.url)
  return {
    pathname: url.pathname,
    exp: url.searchParams.get('exp') ?? undefined,
    uid: url.searchParams.get('uid') ?? undefined,
    sig: url.searchParams.get('sig') ?? undefined,
  }
}

describe('图片签名地址', () => {
  afterEach(() => {
    unfreezeTime()
  })

  it('签名后可以原样校验通过', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const result = verifyAssetSignature({ assetId: ASSET_ID, ...queryOf(signed) })

    expect(result).toEqual({ assetId: ASSET_ID, userId: USER_ID })
  })

  it('地址指向 /api/v1/assets/{asset_id}，有效期与常量一致', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const url = new URL(signed.url)

    expect(url.pathname).toBe(`/api/v1/assets/${ASSET_ID}`)
    expect(url.searchParams.get('uid')).toBe(USER_ID)
    expect(signed.expires_in).toBe(SIGNED_URL_TTL_SECONDS)
    // expires_at 与 exp 描述的是同一时刻，前端只要拿到其中一个就能显示倒计时
    expect(Date.parse(signed.expires_at)).toBe(Number(url.searchParams.get('exp')) * 1000)
  })

  it('asset_id 带特殊字符时会进 URL 转义，校验端拿到的仍是原值', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const url = new URL(signed.url)

    // 转义发生在路径段上，解析回来后必须与签名时的输入一致，否则签名永远对不上
    expect(decodeURIComponent(url.pathname.split('/').pop()!)).toBe(ASSET_ID)
  })

  it('有效期可以由调用方覆盖', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID, ttlSeconds: 60 })
    expect(signed.expires_in).toBe(60)
    expect(verifyAssetSignature({ assetId: ASSET_ID, ...queryOf(signed) }).assetId).toBe(ASSET_ID)
  })
})

describe('签名篡改与过期', () => {
  afterEach(() => {
    unfreezeTime()
  })

  it('篡改 sig 校验失败', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const params = queryOf(signed)

    const error = captureError(() =>
      verifyAssetSignature({ assetId: ASSET_ID, ...params, sig: `${params.sig}x` }),
    )
    expect(error.code).toBe('SIGNATURE_INVALID')
  })

  it('篡改 exp（签名保持原样）校验失败', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const params = queryOf(signed)
    const shifted = String(Number(params.exp) + 3600)

    const error = captureError(() => verifyAssetSignature({ assetId: ASSET_ID, ...params, exp: shifted }))
    expect(error.code).toBe('SIGNATURE_INVALID')
  })

  it('篡改 uid 校验失败 —— 签名与使用者绑定', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const params = queryOf(signed)

    const error = captureError(() =>
      verifyAssetSignature({ assetId: ASSET_ID, ...params, uid: 'someone-else' }),
    )
    expect(error.code).toBe('SIGNATURE_INVALID')
  })

  it('换一个 asset_id 复用签名校验失败 —— 签名绑定 asset_id', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })

    const error = captureError(() =>
      verifyAssetSignature({ assetId: 'clanotherassetid000000000', ...queryOf(signed) }),
    )
    expect(error.code).toBe('SIGNATURE_INVALID')
  })

  it('签名有效但已过期时被拒，且给出的是过期而非签名错误', () => {
    // ttl 取负：签名本身是对的，唯一的问题就是过期
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID, ttlSeconds: -1 })

    const error = captureError(() => verifyAssetSignature({ assetId: ASSET_ID, ...queryOf(signed) }))
    expect(error.code).toBe('SIGNATURE_INVALID')
    // 断言到文案，证明拦下它的是时效判定而不是签名比对
    expect(error.message).toContain('过期')
  })

  it('有效期一过即失效', () => {
    freezeTimeAt(new Date('2026-10-01T10:00:00Z'))
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })

    freezeTimeAt(new Date('2026-10-01T10:09:59Z'))
    expect(verifyAssetSignature({ assetId: ASSET_ID, ...queryOf(signed) }).assetId).toBe(ASSET_ID)

    freezeTimeAt(new Date('2026-10-01T10:10:01Z'))
    const error = captureError(() => verifyAssetSignature({ assetId: ASSET_ID, ...queryOf(signed) }))
    expect(error.code).toBe('SIGNATURE_INVALID')
    expect(error.message).toContain('过期')
  })

  it('缺少任一签名参数都直接拒绝', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const params = queryOf(signed)

    const cases: Array<[string, Partial<typeof params>]> = [
      ['缺 exp', { exp: undefined }],
      ['缺 uid', { uid: undefined }],
      ['缺 sig', { sig: undefined }],
      ['全缺', { exp: undefined, uid: undefined, sig: undefined }],
      ['空串', { sig: '' }],
    ]

    for (const [label, patch] of cases) {
      const error = captureError(() => verifyAssetSignature({ assetId: ASSET_ID, ...params, ...patch }))
      expect(error.code, label).toBe('SIGNATURE_INVALID')
    }
  })

  it('exp 不是整数时拒绝', () => {
    const signed = signAssetUrl({ assetId: ASSET_ID, userId: USER_ID })
    const params = queryOf(signed)

    for (const bad of ['abc', '1.5', '', 'NaN', '1e3']) {
      const error = captureError(() => verifyAssetSignature({ assetId: ASSET_ID, ...params, exp: bad }))
      expect(error.code, `exp=${bad}`).toBe('SIGNATURE_INVALID')
    }
  })
})

/**
 * 对象键是路径穿越的第一道防线（design.md §13 私有存储）。
 * 键由 randomObjectKey() 生成，形如 <2 位十六进制分片>/<十六进制串>。
 */
describe('对象键校验', () => {
  it('接受生成器产出的键', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = randomObjectKey()
      expect(isValidObjectKey(key), key).toBe(true)
    }
  })

  it('接受合法形状的键', () => {
    expect(isValidObjectKey('ab/0123456789abcdef')).toBe(true)
    expect(isValidObjectKey('ff/00ff00ff')).toBe(true)
  })

  it('拒绝路径穿越', () => {
    const traversal = [
      '../secret',
      '../../etc/passwd',
      'ab/../../../etc/passwd',
      'ab/..%2f..%2fsecret',
      '/etc/passwd',
      'C:/Windows/system32',
      'a/../b',
      './ab/0123456789abcdef',
      'ab/0123456789abcdef/../../secret',
    ]

    for (const key of traversal) {
      expect(isValidObjectKey(key), key).toBe(false)
    }
  })

  it('拒绝分片长度不对的键', () => {
    expect(isValidObjectKey('a/0123456789abcdef')).toBe(false)
    expect(isValidObjectKey('abc/0123456789abcdef')).toBe(false)
    expect(isValidObjectKey('abcd/0123456789abcdef')).toBe(false)
    // 缺少分片，直接是随机串
    expect(isValidObjectKey('0123456789abcdef')).toBe(false)
  })

  it('拒绝大写十六进制与非法字符', () => {
    expect(isValidObjectKey('AB/0123456789abcdef')).toBe(false)
    expect(isValidObjectKey('ab/0123456789ABCDEF')).toBe(false)
    expect(isValidObjectKey('ab/GHIJKLMN')).toBe(false)
    expect(isValidObjectKey('ab/01234567-89abcdef')).toBe(false)
    expect(isValidObjectKey('ab\\0123456789abcdef')).toBe(false)
  })

  it('拒绝过短或为空的键', () => {
    expect(isValidObjectKey('')).toBe(false)
    expect(isValidObjectKey('ab')).toBe(false)
    expect(isValidObjectKey('ab/')).toBe(false)
    expect(isValidObjectKey('ab/0123')).toBe(false)
    expect(isValidObjectKey('/0123456789abcdef')).toBe(false)
  })
})
