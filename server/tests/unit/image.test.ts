import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ALLOWED_MIME_TYPES } from '../../src/config/constants.js'
import { processImage, type ProcessedImage } from '../../src/services/image.service.js'
import { fakeJpeg, makeImage } from '../helpers/factory.js'

/**
 * design.md §13 文件存储与安全：
 *   * 后端检查 MIME 类型、文件头、尺寸和文件大小；
 *   * 图片成功解码后再接受上传，无法解码的文件直接拒绝；
 *   * 默认删除 EXIF 等可能包含位置和设备信息的元数据。
 *
 * 这三条都落在 processImage 上，因此这里逐条验证 —— 尤其「按内容识别格式」与
 * 「重新编码剥离 EXIF」，它们是最容易被「顺手优化掉」的两步。
 */

/** 抛出 AppError 时返回 code：比 toThrow 字符串更能说明是哪条规则拦下的 */
async function captureError(run: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await run()
  } catch (error) {
    const err = error as { code?: string; message: string }
    return { code: err.code, message: err.message }
  }
  throw new Error('预期 processImage 抛出 AppError，但它正常返回了')
}

/** 独立于实现算一遍摘要，避免「拿实现去验证实现」 */
function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

describe('图片格式识别', () => {
  it('JPEG / PNG / WebP 都能通过，并保留原格式', async () => {
    const cases = [
      { format: 'jpeg' as const, mimeType: 'image/jpeg' },
      { format: 'png' as const, mimeType: 'image/png' },
      { format: 'webp' as const, mimeType: 'image/webp' },
    ]

    for (const { format, mimeType } of cases) {
      const input = await makeImage(format, { width: 80, height: 40 })
      const result = await processImage(input, DEFAULT_ALLOWED_MIME_TYPES)

      expect(result.mimeType, format).toBe(mimeType)
      expect(result.width, format).toBe(80)
      expect(result.height, format).toBe(40)
      expect(result.buffer.length, format).toBeGreaterThan(0)

      // 重新读一遍输出，确认交给下游的确实是一张可解码的图，而不是空壳
      const meta = await sharp(result.buffer).metadata()
      expect(meta.format, format).toBe(format)
      expect(meta.width, format).toBe(80)
      expect(meta.height, format).toBe(40)
    }
  })

  it('只改扩展名的文本文件被拒绝（§13 不接受伪装文件）', async () => {
    const error = await captureError(() => processImage(fakeJpeg(), DEFAULT_ALLOWED_MIME_TYPES))
    expect(error.code).toBe('UPLOAD_INVALID')
  })

  it('能被 sharp 解码、但不在支持列表里的格式一律拒绝', async () => {
    // SVG 不是位图，允许上传会让「证明材料」变成可携带脚本的文件
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    )
    const forSvg = await captureError(() => processImage(svg, DEFAULT_ALLOWED_MIME_TYPES))
    expect(forSvg.code).toBe('UPLOAD_INVALID')

    // GIF 是真正的图片格式，但 §7.4 只承诺 JPEG / PNG / WebP
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .gif()
      .toBuffer()
    const forGif = await captureError(() => processImage(gif, DEFAULT_ALLOWED_MIME_TYPES))
    expect(forGif.code).toBe('UPLOAD_INVALID')
  })

  it('活动未开放该格式时同样拒绝，即使格式本身受支持', async () => {
    const jpeg = await makeImage('jpeg')

    const error = await captureError(() => processImage(jpeg, ['image/png']))
    expect(error.code).toBe('UPLOAD_INVALID')
    expect(error.message).toContain('image/jpeg')
  })
})

/**
 * §13「默认删除 EXIF 等可能包含位置和设备信息的元数据」。
 *
 * 用带 GPS 与相机型号的输入，验证产出里连设备信息都不剩 ——
 * 这既是隐私要求，也顺带说明流水线确实重新编码过，而不是原样透传。
 */
describe('EXIF 剥离', () => {
  const CAMERA_MARK = Buffer.from('TestCamera', 'utf8')

  for (const format of ['jpeg', 'png', 'webp'] as const) {
    it(`${format} 的 EXIF 与 GPS 在输出中消失`, async () => {
      const input = await makeImage(format, { exif: true })

      // 前置断言：输入确实带着 EXIF，否则下面的断言会变成空验证
      const inputMeta = await sharp(input).metadata()
      expect(inputMeta.exif, '输入图片应带有 EXIF').toBeDefined()
      expect(input.includes(CAMERA_MARK), '输入图片应带有相机型号').toBe(true)

      const result: ProcessedImage = await processImage(input, DEFAULT_ALLOWED_MIME_TYPES)

      const outputMeta = await sharp(result.buffer).metadata()
      // sharp 只在存在 EXIF 时才给出 exif 字段，undefined 即「整块都没了」
      expect(outputMeta.exif).toBeUndefined()
      // 独立佐证：连设备型号的字节都不再出现（GPS 与 Make 同在一个 EXIF 段里）
      expect(result.buffer.includes(CAMERA_MARK)).toBe(false)
      // 尺寸不受影响：剥离元数据不该改变画面
      expect(outputMeta.width).toBe(64)
      expect(outputMeta.height).toBe(64)
    })
  }
})

describe('产出元数据与真实字节一致', () => {
  it('sha256 / width / height / size 都对应重新编码后的内容', async () => {
    const input = await makeImage('jpeg', { width: 120, height: 90 })
    const result = await processImage(input, DEFAULT_ALLOWED_MIME_TYPES)

    expect(result.size).toBe(result.buffer.length)
    // 摘要算的是「处理后的内容」：用于提示疑似重复证明（§13），必须是输出字节的摘要
    expect(result.sha256).toBe(sha256Of(result.buffer))
    // 输入未经过流水线，摘要必然不同 —— 证明不是直接抄输入的摘要
    expect(result.sha256).not.toBe(sha256Of(input))

    const meta = await sharp(result.buffer).metadata()
    expect(result.width).toBe(meta.width)
    expect(result.height).toBe(meta.height)
    expect(result.size).toBe(meta.size)
  })

  it('同一输入两次处理的摘要一致', async () => {
    const input = await makeImage('png')
    const first = await processImage(input, DEFAULT_ALLOWED_MIME_TYPES)
    const second = await processImage(input, DEFAULT_ALLOWED_MIME_TYPES)

    expect(first.sha256).toBe(second.sha256)
  })
})
