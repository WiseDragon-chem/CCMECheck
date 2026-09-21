import { describe, expect, it } from 'vitest'
import {
  COMPRESS_TARGET_BYTES,
  MAX_EDGE,
  compressToTarget,
  type CompressDeps,
  type DecodedImage,
} from './imageCompress'

/**
 * 压缩策略的单测。
 *
 * 全部注入 fake 依赖，不碰真 canvas —— jsdom 里既没有 canvas 也没有
 * createImageBitmap。这里要守的是**策略**：缩放到什么尺寸、在哪一档停下、
 * 超标之后怎么收敛、失败怎么冒泡。真实解码/编码由 e2e 覆盖。
 */

interface EncodeCall {
  width: number
  height: number
  quality: number
}

interface FakeOptions {
  width: number
  height: number
  /** 给定本次编码的总像素数与质量，返回字节数；返回 null 模拟 toBlob 失败 */
  sizeFor: (pixels: number, quality: number) => number | null
}

function makeDeps(options: FakeOptions) {
  const calls: EncodeCall[] = []
  const sizes: number[] = []
  let closed = false

  const deps: CompressDeps = {
    async decode(): Promise<DecodedImage> {
      return {
        width: options.width,
        height: options.height,
        source: {} as CanvasImageSource,
        close: () => {
          closed = true
        },
      }
    },
    async encode(_source, width, height, quality) {
      calls.push({ width, height, quality })
      const size = options.sizeFor(width * height, quality)
      if (size === null) return null
      sizes.push(size)
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' })
    },
  }

  return { deps, calls, sizes, wasClosed: () => closed }
}

function jpegFile(bytes = 16, name = 'proof.png'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('compressToTarget', () => {
  it('长边超过上限的图先缩放，且保持比例', async () => {
    const { deps, calls } = makeDeps({ width: 4000, height: 3000, sizeFor: () => 100 })

    await compressToTarget(jpegFile(), COMPRESS_TARGET_BYTES, deps)

    expect(calls[0]).toEqual({ width: MAX_EDGE, height: 1920, quality: 0.82 })
  })

  it('长边没超上限的图不放大也不缩小', async () => {
    // 常见手机截图 1170×2532，长边在 2560 之下 —— 审核要看的字不该被动
    const { deps, calls } = makeDeps({ width: 1170, height: 2532, sizeFor: () => 100 })

    await compressToTarget(jpegFile(), COMPRESS_TARGET_BYTES, deps)

    expect(calls[0]).toMatchObject({ width: 1170, height: 2532 })
  })

  it('停在第一个达标的档位，而不是一路降到最低', async () => {
    // 0.82→820、0.72→720、0.62→620 都超标；0.52→520 是第一个达标的
    const { deps, calls } = makeDeps({
      width: 800,
      height: 600,
      sizeFor: (_pixels, quality) => Math.round(quality * 1000),
    })

    const result = await compressToTarget(jpegFile(), 600, deps)

    expect(calls.map((call) => call.quality)).toEqual([0.82, 0.72, 0.62, 0.52])
    expect(result.size).toBe(520)
  })

  it('质量阶梯走完仍超标时缩小尺寸重来，最多再两轮', async () => {
    const { deps, calls } = makeDeps({ width: 2560, height: 1920, sizeFor: () => 10_000 })

    await compressToTarget(jpegFile(), 600, deps)

    // 3 轮 × 5 档
    expect(calls).toHaveLength(15)
    expect(calls[0]).toMatchObject({ width: 2560, height: 1920 })
    expect(calls[5]).toMatchObject({ width: 1920, height: 1440 })
    expect(calls[10]).toMatchObject({ width: 1440, height: 1080 })
  })

  it('怎么都压不进时返回最小的一次，不抛错 —— 上层要据此给出准确文案', async () => {
    // 体积随像素数与质量单调变化，于是最小值必然出现在最后一轮
    const { deps, sizes } = makeDeps({
      width: 1200,
      height: 900,
      sizeFor: (pixels, quality) => Math.round((pixels / 100) * quality),
    })

    const result = await compressToTarget(jpegFile(), 1, deps)

    expect(sizes.length).toBeGreaterThan(1)
    expect(result.size).toBe(Math.min(...sizes))
  })

  it('toBlob 返回 null 时跳过该档，不影响其余档位', async () => {
    const { deps } = makeDeps({
      width: 800,
      height: 600,
      sizeFor: (_pixels, quality) => (quality > 0.7 ? null : 200),
    })

    const result = await compressToTarget(jpegFile(), 600, deps)

    expect(result.size).toBe(200)
  })

  it('所有档位都编码失败时抛错', async () => {
    const { deps } = makeDeps({ width: 800, height: 600, sizeFor: () => null })

    await expect(compressToTarget(jpegFile(), 600, deps)).rejects.toThrow('图片编码失败')
  })

  it('解码失败向上抛，由调用方转成用户可读的提示', async () => {
    const deps: CompressDeps = {
      decode: () => Promise.reject(new Error('图片解码失败')),
      encode: () => Promise.resolve(null),
    }

    await expect(compressToTarget(jpegFile(), 600, deps)).rejects.toThrow('图片解码失败')
  })

  it('输出是 JPEG，文件名沿用原名', async () => {
    const { deps } = makeDeps({ width: 800, height: 600, sizeFor: () => 100 })

    const result = await compressToTarget(jpegFile(16, 'IMG_1234.png'), COMPRESS_TARGET_BYTES, deps)

    // type 会被带成 multipart 的 Content-Type，服务端 fileFilter 拿它做粗筛
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('IMG_1234.png')
  })

  it('达标提前返回与抛错两条路径都会释放解码资源', async () => {
    const fitting = makeDeps({ width: 800, height: 600, sizeFor: () => 100 })
    await compressToTarget(jpegFile(), COMPRESS_TARGET_BYTES, fitting.deps)
    expect(fitting.wasClosed()).toBe(true)

    const failing = makeDeps({ width: 800, height: 600, sizeFor: () => null })
    await expect(compressToTarget(jpegFile(), 600, failing.deps)).rejects.toThrow()
    expect(failing.wasClosed()).toBe(true)
  })
})
