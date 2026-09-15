/**
 * design.md §7.6：排行榜可能不便公开真实姓名，可配置为脱敏形式。
 * 这里实现文档点名的「姓氏＋名字末字」，其余字符用 * 代替。
 */
export function maskName(name: string): string {
  const chars = [...name.trim()]
  if (chars.length === 0) return ''
  if (chars.length === 1) return chars[0]!
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`
}

export function displayName(name: string, mode: string): string {
  return mode === 'masked' ? maskName(name) : name
}

/**
 * CSV 注入防护。
 *
 * 参赛者填写的备注、驳回原因等字段会原样进入管理员用 Excel 打开的导出文件。
 * 以 = + - @ 或制表符开头的单元格会被 Excel / LibreOffice 当作公式执行，
 * 因此在这类值前加一个单引号，强制按文本处理（CWE-1236）。
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

/**
 * 给可能的公式加单引号前缀，强制按文本处理。
 * 供 csv-stringify 的 cast 选项复用（见 participants 模块的导出）。
 */
export function guardCsvFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text
}

/** CSV 输出用：把值安全地放进一个字段 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const guarded = guardCsvFormula(String(value))

  // 含分隔符、引号或换行时加引号并转义内部引号（RFC 4180）
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`
  return guarded
}

/**
 * csv-stringify 的 cast 配置：只处理字符串单元格。
 * 数字、布尔值不需要防注入，也不能被加上引号。
 */
export const csvFormulaCast = {
  cast: {
    string: (value: string) => guardCsvFormula(value),
  },
} as const

/**
 * 生成 CSV 文本。
 * 带 UTF-8 BOM —— 否则 Windows 版 Excel 打开会把中文显示成乱码。
 */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
