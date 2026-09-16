import { describe, expect, it } from 'vitest'
import { buildCheckinFormData } from '@/api/upload'
import { detectImageType } from '@/lib/imageMagicBytes'
import { validateFile } from './components/imagePicker.utils'

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

  it('拒绝超出单张大小限制的图片', async () => {
    const big = file('big.jpg', JPEG_HEAD)
    // 直接构造一个超过限制的 File，避免真的分配 11MB
    const oversized = { name: 'big.jpg', size: RULES.max_image_bytes + 1, slice: () => big.slice(0, 16) } as unknown as File
    const result = await validateFile(oversized, RULES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('超过')
  })

  it('拒绝活动配置之外的格式', async () => {
    const pngOnly = { ...RULES, allowed_mime_types: ['image/png'] }
    const result = await validateFile(file('a.jpg', JPEG_HEAD), pngOnly)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('不接受')
  })
})
