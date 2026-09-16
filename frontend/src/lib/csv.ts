/**
 * 前端生成 CSV。
 *
 * 只用在「把服务端一次性返回的明文交给管理员带走」这一处
 * （激活码、临时密码）—— 那批数据关掉对话框就再也拿不回来了，
 * 复制粘贴十几个还行，上百个就只能落成文件。
 *
 * 另外两个导出（名册、打卡明细）走的是服务端的导出接口，
 * 不经过这里；服务端的 CSV 由它自己的 csv 模块生成。
 */

/** Excel 认 BOM 才按 UTF-8 解，否则中文全是乱码。服务端的导出也是这么做的 */
const BOM = '﻿'

/**
 * 单元格转义。
 *
 * 名字里带逗号（「张三,李四」）或引号是完全可能的，
 * 不转义会让后面所有列都错位，而且打开时看不出哪里错了。
 * 以 = + - @ 开头的值还要加个前导单引号 —— 那是 Excel 的公式前缀，
 * 一个叫「=1+1」的备注会变成真的公式（服务端的 csvFormulaCast 同理）。
 */
function escapeCell(value: string): string {
  const cell = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export function toCsvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(','))
  return BOM + lines.join('\r\n')
}
