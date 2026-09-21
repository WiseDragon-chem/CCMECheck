/**
 * 上传前把图片压到指定字节数以内。
 *
 * 手机原图动辄 5–10MB，而审核只需要能看清证明材料上的字 ——
 * 在手机上多传的每一个字节都是用户实打实在等的秒数。
 *
 * 两个必须自己处理的坑：
 *
 *  * **方向。** canvas 重绘会丢掉全部 EXIF，包括 Orientation。
 *    方向必须在解码那一步就应用（`imageOrientation: 'from-image'`），
 *    否则 iPhone 竖拍的照片会横躺 —— 服务端的 `.rotate()` 此时拿不到
 *    Orientation，已经是 no-op，救不回来。
 *  * **尺寸。** 服务端有一道 50MP 的像素闸（防解压炸弹），1 亿像素的
 *    手机原图即使压到 600KB 也会被拒。所以压缩必须同时缩尺寸。
 *
 * 依赖是注入的：测试环境是 jsdom，没有 canvas 也没有 createImageBitmap，
 * 不注入就只能靠 e2e 覆盖，而这里的分支（质量阶梯、缩尺寸重试、编码失败）
 * 恰恰是 e2e 最难稳定触发的部分。
 */

/** 产品要求：上传的证明材料单张不超过 600KB */
export const COMPRESS_TARGET_BYTES = 600 * 1024

/**
 * 长边上限：只对**超出它**的图先缩一道，之后才轮到质量阶梯。
 *
 * 取 2560 是为了让常见手机截图原样通过 —— 1080×2400、1170×2532、
 * 1179×2556 的长边都在它之下。审核看的就是截图上的字，不该为了体积
 * 先把像素砍掉；体积不够时优先降质量，那是阶梯的事。
 *
 * 顺带把服务端那道 50MP 像素闸（防解压炸弹）也挡住了：1 亿像素的
 * 手机原图即使压到 600KB 也会被它拒，且报的是「无法识别的图片文件」。
 */
export const MAX_EDGE = 2560

/** 连试都不试的上限：在手机上解码 20MB 以上的图有把标签页撑爆的风险 */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024

/** 质量阶梯。从高到低取第一个达标的，所以通常只用得着第一档 */
const QUALITY_LADDER = [0.82, 0.72, 0.62, 0.52, 0.42] as const

/** 阶梯走完仍超标时缩小尺寸重来的轮数上限 */
const MAX_SHRINK_ROUNDS = 2

const SHRINK_FACTOR = 0.75

/** 解码后可直接交给 drawImage 的图源 */
export interface DecodedImage {
  width: number
  height: number
  source: CanvasImageSource
  /** 释放底层资源（ImageBitmap.close / revokeObjectURL） */
  close(): void
}

export interface CompressDeps {
  decode(file: Blob): Promise<DecodedImage>
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ): Promise<Blob | null>
}

/**
 * 解码。优先 createImageBitmap —— 它能在主线程之外解码，大图不会卡界面。
 *
 * `imageOrientation: 'from-image'` 必须显式给：输出经重绘后 EXIF 全丢，
 * 方向只能在这一步定下来。不支持该选项的旧浏览器会退到 <img> 那条路，
 * 后者按 CSS 的 `image-orientation: from-image`（初始值）同样会摆正。
 */
async function decodeInBrowser(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      source: element,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function encodeInBrowser(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  // 不用 OffscreenCanvas：Safari 16.4 之前不支持，而参赛者几乎都是手机
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) return null

  // JPEG 没有 alpha 通道，不铺底的话 PNG 的透明区域会变成黑块
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

const browserDeps: CompressDeps = {
  decode: decodeInBrowser,
  encode: encodeInBrowser,
}

function toJpegFile(blob: Blob, name: string): File {
  /*
    type 必须显式给：它会被 upload.ts 带成 multipart 的 Content-Type，
    而服务端的 fileFilter 拿它做粗筛，缺了就是「只能上传图片文件」。

    文件名原样保留（包括 .png 这种原扩展名）—— 服务端按内容识别格式，
    文件名在 fileFilter 之后再无消费者，为它加一条改名分支不划算。
  */
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
}

/**
 * 把图片压到 `targetBytes` 以内，输出 JPEG。
 *
 * 先按质量阶梯从高到低试，全部超标才缩小尺寸重来。早停在第一档达标处，
 * 是为了尽量少编码 —— 手机上每次 toBlob 都是几十到几百毫秒。
 *
 * 全部走完仍超标时**返回最小的那一次，不抛错**：调用方要据此给出
 * 「压缩后仍有 X」的准确文案，抛错反而丢掉了这个信息。
 */
export async function compressToTarget(
  file: File,
  targetBytes: number,
  deps: CompressDeps = browserDeps,
): Promise<File> {
  const decoded = await deps.decode(file)

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
    let width = Math.max(1, Math.round(decoded.width * scale))
    let height = Math.max(1, Math.round(decoded.height * scale))
    let smallest: Blob | null = null

    for (let round = 0; round <= MAX_SHRINK_ROUNDS; round += 1) {
      for (const quality of QUALITY_LADDER) {
        const blob = await deps.encode(decoded.source, width, height, quality)
        // toBlob 在内存吃紧时会回调 null，跳过这一档而不是整个失败
        if (!blob) continue
        if (!smallest || blob.size < smallest.size) smallest = blob
        if (blob.size <= targetBytes) return toJpegFile(blob, file.name)
      }

      width = Math.max(1, Math.round(width * SHRINK_FACTOR))
      height = Math.max(1, Math.round(height * SHRINK_FACTOR))
    }

    if (!smallest) throw new Error('图片编码失败')
    return toJpegFile(smallest, file.name)
  } finally {
    decoded.close()
  }
}
