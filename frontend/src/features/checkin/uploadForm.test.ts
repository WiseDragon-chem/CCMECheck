import { describe, expect, it } from 'vitest'
import { buildCheckinFormData } from '@/api/upload'
import { MAX_INPUT_BYTES, type CompressDeps } from '@/lib/imageCompress'
import { detectImageType } from '@/lib/imageMagicBytes'
import { checkSize, prepareImage, validateFile } from './components/imagePicker.utils'

/**
 * 提交表单的构造与本地校验。
 *
 * 这两件事都属于「错了不报错、只是数据不对」的类型：
 * 顺序错了图片排序与用户看到的不一致，校验漏了会让用户在
 * 上传几十秒之后才被服务端拒绝。
 */

function file(name: string, bytes: number[], type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0]
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP_HEAD = [...Array.from('RIFF').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...Array.from('WEBP').map((c) => c.charCodeAt(0))]

const RULES = {
  min_images: 1,
  max_images: 3,
  max_image_bytes: 10 * 1024 * 1024,
  allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
}

/**
 * 只带 name / size / slice 的假 File。
 *
 * 魔数那一步能正常走完（slice 返回真的 JPEG 头），又不必真的分配几 MB。
 */
function fakeFile(name: string, size: number, head = JPEG_HEAD): File {
  const headFile = new File([new Uint8Array(head)], name, { type: 'image/jpeg' })
  return { name, size, slice: () => headFile.slice(0, 16) } as unknown as File
}

/**
 * 注入假的解码/编码。
 *
 * jsdom 里没有 canvas，压缩的真实路径由 lib/imageCompress.test.ts 与 e2e 覆盖；
 * 这里只关心 prepareImage 的编排：什么时候压、压完拿什么去校验。
 */
function fakeCompress(sizeAfter: number | null) {
  let decodeCalls = 0
  const deps: CompressDeps = {
    async decode() {
      decodeCalls += 1
      return { width: 100, height: 100, source: {} as CanvasImageSource, close: () => {} }
    },
    async encode() {
      return sizeAfter === null ? null : new Blob([new Uint8Array(sizeAfter)], { type: 'image/jpeg' })
    },
  }
  return { deps, decodeCalls: () => decodeCalls }
}

describe('提交表单构造', () => {
  it('图片按传入顺序 append —— 这个顺序就是服务端的 sort_order', () => {
    const a = file('a.jpg', JPEG_HEAD)
    const b = file('b.jpg', JPEG_HEAD)
    const c = file('c.jpg', JPEG_HEAD)

    const form = buildCheckinFormData({
      track: 'reading',
      activityDate: '2026-10-01',
      note: null,
      clientToken: 'token-1',
      images: [c, a, b],
    })

    // FormData.getAll 保留 append 顺序
    const names = form.getAll('images').map((entry) => (entry as File).name)
    expect(names).toEqual(['c.jpg', 'a.jpg', 'b.jpg'])
  })

  it('重排后再构造，顺序随之改变', () => {
    const a = file('a.jpg', JPEG_HEAD)
    const b = file('b.jpg', JPEG_HEAD)

    const before = buildCheckinFormData({
      track: 'reading',
      activityDate: '2026-10-01',
      note: null,
      clientToken: 't',
      images: [a, b],
    })
    const after = buildCheckinFormData({
      track: 'reading',
      activityDate: '2026-10-01',
      note: null,
      clientToken: 't',
      images: [b, a],
    })

    expect(before.getAll('images').map((f) => (f as File).name)).toEqual(['a.jpg', 'b.jpg'])
    expect(after.getAll('images').map((f) => (f as File).name)).toEqual(['b.jpg', 'a.jpg'])
  })

  it('带上赛道、活动日与幂等键', () => {
    const form = buildCheckinFormData({
      track: 'fitness',
      activityDate: '2026-10-02',
      note: '跑了 5 公里',
      clientToken: 'abc-123',
      images: [file('a.jpg', JPEG_HEAD)],
    })

    expect(form.get('track')).toBe('fitness')
    expect(form.get('activity_date')).toBe('2026-10-02')
    expect(form.get('client_token')).toBe('abc-123')
    expect(form.get('note')).toBe('跑了 5 公里')
  })

  it('备注为空时不传该字段，而不是传一个空串', () => {
    const form = buildCheckinFormData({
      track: 'reading',
      activityDate: '2026-10-01',
      note: null,
      clientToken: 't',
      images: [file('a.jpg', JPEG_HEAD)],
    })
    expect(form.get('note')).toBeNull()
  })
})

describe('按文件内容识别格式', () => {
  it('识别 JPEG / PNG / WebP', () => {
    expect(detectImageType(new Uint8Array(JPEG_HEAD))).toBe('image/jpeg')
    expect(detectImageType(new Uint8Array(PNG_HEAD))).toBe('image/png')
    expect(detectImageType(new Uint8Array(WEBP_HEAD))).toBe('image/webp')
  })

  it('伪装成图片的文本被识破（§7.4 不接受仅改扩展名的文件）', () => {
    const text = new TextEncoder().encode('这不是图片，只是把扩展名改成了 .jpg')
    expect(detectImageType(text)).toBeNull()
  })

  it('GIF / SVG 等不支持的类型返回 null', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(detectImageType(gif)).toBeNull()
    expect(detectImageType(svg)).toBeNull()
  })

  it('空文件与过短的文件不报错', () => {
    expect(detectImageType(new Uint8Array([]))).toBeNull()
    expect(detectImageType(new Uint8Array([0xff]))).toBeNull()
    // RIFF 开头但没有 WEBP 标记
    expect(detectImageType(new Uint8Array([...Array.from('RIFF').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 1, 2, 3, 4]))).toBeNull()
  })
})

describe('选图前的本地校验', () => {
  it('接受合法的图片', async () => {
    await expect(validateFile(file('a.jpg', JPEG_HEAD), RULES)).resolves.toEqual({ ok: true })
  })

  it('拒绝改扩展名的伪装文件', async () => {
    const fake = file('fake.jpg', Array.from(new TextEncoder().encode('其实是文本')))
    const result = await validateFile(fake, RULES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('不是有效的图片')
  })

  it('拒绝活动配置之外的格式', async () => {
    const pngOnly = { ...RULES, allowed_mime_types: ['image/png'] }
    const result = await validateFile(file('a.jpg', JPEG_HEAD), pngOnly)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('不接受')
  })

  it('不看大小 —— 大图要留给压缩去救，不能在这里拦掉', async () => {
    // validateFile 只管内容与格式。一张 5MB 的手机照片本该能压下来，
    // 用原文件大小拦它等于把整个压缩功能关掉。大小在 checkSize 里查
    await expect(validateFile(fakeFile('big.jpg', 5 * 1024 * 1024), RULES)).resolves.toEqual({ ok: true })
  })
})

describe('压缩后的大小校验', () => {
  it('接受限额以内的产物', () => {
    expect(checkSize(file('a.jpg', JPEG_HEAD), RULES)).toEqual({ ok: true })
  })

  it('拒绝超出单张限额的产物', () => {
    // 直接构造一个超过限制的 File，避免真的分配 11MB
    const oversized = { name: 'big.jpg', size: RULES.max_image_bytes + 1 } as File
    const result = checkSize(oversized, RULES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('压缩后仍有')
      expect(result.reason).toContain('超过')
    }
  })
})

describe('选图后的完整处理（校验 → 按需压缩 → 校验大小）', () => {
  const LIVE_RULES = { ...RULES, max_image_bytes: 640 * 1024 }

  it('原文件超限、压缩后达标 —— 放行，且收下的是压缩产物', async () => {
    const { deps, decodeCalls } = fakeCompress(300 * 1024)

    const result = await prepareImage(fakeFile('photo.jpg', 5 * 1024 * 1024), LIVE_RULES, deps)

    expect(decodeCalls()).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.size).toBe(300 * 1024)
      // type 会被带成 multipart 的 Content-Type，服务端 fileFilter 拿它粗筛
      expect(result.file.type).toBe('image/jpeg')
    }
  })

  it('原文件本来就达标时压根不解码 —— 小图零额外损失', async () => {
    const { deps, decodeCalls } = fakeCompress(100)

    const result = await prepareImage(file('small.jpg', JPEG_HEAD), LIVE_RULES, deps)

    expect(decodeCalls()).toBe(0)
    expect(result.ok).toBe(true)
  })

  it('压缩后仍超限时给出「压缩后仍有 X」的准确文案', async () => {
    // 满屏噪点这类图确实可能压不到 600KB 以内
    const { deps } = fakeCompress(LIVE_RULES.max_image_bytes + 1)

    const result = await prepareImage(fakeFile('noise.jpg', 5 * 1024 * 1024), LIVE_RULES, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('压缩后仍有')
  })

  it('大到不敢解码的直接拒绝，且不去碰解码器', async () => {
    const { deps, decodeCalls } = fakeCompress(100)

    const result = await prepareImage(fakeFile('huge.jpg', MAX_INPUT_BYTES + 1), LIVE_RULES, deps)

    expect(decodeCalls()).toBe(0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('超出可处理的范围')
  })

  it('浏览器解不开时给出「无法处理」，而不是让它传完再被服务端拒', async () => {
    const { deps } = fakeCompress(null)

    const result = await prepareImage(fakeFile('broken.jpg', 5 * 1024 * 1024), LIVE_RULES, deps)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('无法处理')
  })

  it('活动把上限配得比 600KB 还小时，压缩目标跟着它走', async () => {
    // 否则压到 600KB 仍会被服务端拒 —— 两端的判据必须一致
    const strict = { ...RULES, max_image_bytes: 200 * 1024 }
    const { deps } = fakeCompress(150 * 1024)

    const result = await prepareImage(fakeFile('photo.jpg', 5 * 1024 * 1024), strict, deps)

    expect(result.ok).toBe(true)
  })
})
