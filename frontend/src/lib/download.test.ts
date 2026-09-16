import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './download'

/**
 * 从响应头里取文件名。
 *
 * 这段解析错了不会报错，只会把文件存成一个莫名其妙的名字 ——
 * 而那种问题没人会去查，用户只会觉得「下载下来打不开」。
 * 后端的 sendCsv 同时给了 ASCII 回退与 RFC 5987 两种形式，
 * 两种都要认，且要优先用带中文的那个。
 */

const FALLBACK = 'export.csv'

describe('Content-Disposition 的文件名解析', () => {
  it('没有响应头时用回退名', () => {
    expect(filenameFromDisposition(null, FALLBACK)).toBe(FALLBACK)
  })

  it('解析普通的 filename', () => {
    expect(filenameFromDisposition('attachment; filename="participants.csv"', FALLBACK)).toBe(
      'participants.csv',
    )
  })

  it('同时存在时优先用 filename* —— 它才能带中文', () => {
    const header =
      "attachment; filename=\"export.csv\"; filename*=UTF-8''%E5%8F%82%E8%B5%9B%E5%90%8D%E5%86%8C.csv"
    expect(filenameFromDisposition(header, FALLBACK)).toBe('参赛名册.csv')
  })

  it('未加引号的 filename 也认', () => {
    expect(filenameFromDisposition('attachment; filename=participants.csv', FALLBACK)).toBe(
      'participants.csv',
    )
  })

  it('filename* 没有语言标签时按原样百分号解码', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E4%B8%AD.csv", FALLBACK)).toBe('中.csv')
  })

  it('百分号编码坏掉时退回 ASCII 名，而不是让整个导出失败', () => {
    // 一个响应头不该让一次已经取到字节的导出白费
    const header = 'attachment; filename="participants.csv"; filename*=UTF-8\'\'%E4%B8%AD%ZZ.csv'
    expect(filenameFromDisposition(header, FALLBACK)).toBe('participants.csv')
  })

  it('文件名里的路径分隔符换成下划线', () => {
    // 活动名里有个斜杠时，带路径的名字在部分浏览器上会被忽略或截断
    const header = "attachment; filename*=UTF-8''%E5%9B%BD%E5%BA%86%2F%E6%89%93%E5%8D%A1.csv"
    expect(filenameFromDisposition(header, FALLBACK)).toBe('国庆_打卡.csv')
  })

  it('解析出来是空串时用回退名', () => {
    expect(filenameFromDisposition('attachment; filename=""', FALLBACK)).toBe(FALLBACK)
  })

  it('大小写不敏感 —— 响应头不保证大小写', () => {
    expect(filenameFromDisposition('attachment; FILENAME="a.csv"', FALLBACK)).toBe('a.csv')
  })
})
