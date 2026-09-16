import { describe, expect, it } from 'vitest'
import { toCsvText } from './csv'

/**
 * 前端生成的 CSV（目前只有一次性明文那一处）。
 *
 * 转义错了不会报错，只会让文件打开后所有列错位 —— 而这类文件是拿去
 * 逐个转发给学生的，错了要等到有人反馈「我的激活码不对」才会发现。
 */

const HEADER = ['student_id', 'name', 'code']

describe('CSV 生成', () => {
  it('带 BOM —— 否则 Excel 打开中文是乱码', () => {
    expect(toCsvText(HEADER, [['1', '张三', 'ABC']]).startsWith('﻿')).toBe(true)
  })

  it('普通值不加引号', () => {
    expect(toCsvText(HEADER, [['1', '张三', 'ABC']])).toContain('1,张三,ABC')
  })

  it('含逗号的值加引号', () => {
    expect(toCsvText(HEADER, [['1', '张三,李四', 'ABC']])).toContain('"张三,李四"')
  })

  it('含引号的值把引号翻倍', () => {
    expect(toCsvText(HEADER, [['1', '张"三', 'ABC']])).toContain('"张""三"')
  })

  it('含换行的值加引号而不是把行拆开', () => {
    const text = toCsvText(HEADER, [['1', '张\n三', 'ABC']])
    expect(text).toContain('"张\n三"')
    // 记录之间是 CRLF，值内部是 LF —— 按记录分隔符切仍然只有表头 + 一行
    expect(text.split('\r\n')).toHaveLength(2)
  })

  it('以 = + - @ 开头的值加前导单引号，避免被 Excel 当公式', () => {
    // 一个叫「=1+1」的备注在 Excel 里会变成真的公式
    expect(toCsvText(HEADER, [['1', '=1+1', 'ABC']])).toContain("'=1+1")
    expect(toCsvText(HEADER, [['1', '+86', 'ABC']])).toContain("'+86")
  })

  it('用 CRLF 分隔 —— Excel 对单纯的 LF 兼容性更差', () => {
    expect(toCsvText(HEADER, [['1', '张三', 'ABC']])).toContain('\r\n')
  })
})
