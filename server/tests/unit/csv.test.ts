import { describe, expect, it } from 'vitest'
import { parse } from 'csv-parse/sync'
import { csvCell, maskName, displayName, guardCsvFormula, toCsv } from '../../src/core/text.js'

/**
 * CSV 导出是活动结束后交付成果的一部分（design.md §3、§16.16）。
 * 这里覆盖两件容易出错的事：中文编码与公式注入。
 */
describe('CSV 工具', () => {
  describe('RFC 4180 转义', () => {
    it('含逗号、引号、换行的值加引号并转义', () => {
      expect(csvCell('读书 30 页, 已完成')).toBe('"读书 30 页, 已完成"')
      expect(csvCell('他说"完成"了')).toBe('"他说""完成""了"')
      expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"')
    })

    it('普通值不加引号', () => {
      expect(csvCell('张三')).toBe('张三')
      expect(csvCell(1000)).toBe('1000')
    })

    it('空值输出空字符串，不输出 null', () => {
      expect(csvCell(null)).toBe('')
      expect(csvCell(undefined)).toBe('')
    })

    it('转义后的值能被标准 CSV 解析器原样读回', () => {
      const headers = ['学号', '备注']
      const tricky = '读书 30 页, 已"完成"'
      const csv = toCsv(headers, [['2026001', tricky]])

      const rows = parse(csv.replace(/^﻿/, ''), { relaxColumnCount: true })
      expect(rows[0]).toEqual(headers)
      expect(rows[1]).toEqual(['2026001', tricky])
    })
  })

  describe('公式注入防护（CWE-1236）', () => {
    it('以 = + - @ 开头的值被加单引号前缀', () => {
      expect(guardCsvFormula('=1+1')).toBe("'=1+1")
      expect(guardCsvFormula('+1')).toBe("'+1")
      expect(guardCsvFormula('-1')).toBe("'-1")
      expect(guardCsvFormula('@SUM(A1)')).toBe("'@SUM(A1)")
      expect(guardCsvFormula('=HYPERLINK("http://evil","点我")')).toBe('\'=HYPERLINK("http://evil","点我")')
    })

    it('制表符与回车开头同样被拦下', () => {
      expect(guardCsvFormula('\t=1+1')).toBe("'\t=1+1")
      expect(guardCsvFormula('\r=1+1')).toBe("'\r=1+1")
    })

    it('正常文本不受影响', () => {
      expect(guardCsvFormula('读书 30 页')).toBe('读书 30 页')
      expect(guardCsvFormula('2026001')).toBe('2026001')
      expect(guardCsvFormula('张三')).toBe('张三')
    })

    it('参赛者备注里的公式在导出时被中和', () => {
      // 备注是参赛者可控输入，会被管理员用 Excel 打开
      const csv = toCsv(['备注'], [['=cmd|\' /c calc\'!A0']])
      // 第 0 行是表头，数据在第 1 行
      const rows = csv.replace(/^﻿/, '').split('\r\n')
      expect(rows[0]).toBe('备注')
      expect(rows[1]).toBe("'=cmd|' /c calc'!A0")
    })
  })

  describe('UTF-8 BOM', () => {
    it('导出带 BOM，否则 Windows 版 Excel 打开中文乱码', () => {
      const csv = toCsv(['学号'], [['2026001']])
      expect(csv.startsWith('﻿')).toBe(true)
      expect(csv.charCodeAt(0)).toBe(0xfeff)
    })

    it('使用 CRLF 换行', () => {
      const csv = toCsv(['a', 'b'], [['1', '2']])
      expect(csv).toContain('\r\n')
    })
  })

  describe('姓名脱敏（§7.6）', () => {
    it('三字及以上保留首字与末字', () => {
      expect(maskName('张三丰')).toBe('张*丰')
      expect(maskName('欧阳修文')).toBe('欧**文')
    })

    it('两字保留首字', () => {
      expect(maskName('张三')).toBe('张*')
    })

    it('单字原样返回', () => {
      expect(maskName('张')).toBe('张')
    })

    it('按活动配置切换', () => {
      expect(displayName('张三丰', 'real')).toBe('张三丰')
      expect(displayName('张三丰', 'masked')).toBe('张*丰')
    })
  })
})
