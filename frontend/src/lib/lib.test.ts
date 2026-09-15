import { describe, expect, it } from 'vitest'
import { formatActivityDate, formatActivityDateLong, formatCst, formatRemaining, parseDateOnly } from './datetime'
import { formatMilli, formatScore, parsePointsToMilli } from './milli'
import { newClientToken } from './clientToken'

describe('活动日格式化', () => {
  /**
   * 活动日是 `YYYY-MM-DD` 文本，绝不能被 `new Date()` 解析。
   *
   * JS 规范里 date-only 形式按 UTC 午夜解析：`new Date('2026-10-01')`
   * 在 UTC 以东的时区显示为 10-01，在 UTC 以西（比如洛杉矶）则显示成 09-30 ——
   * 同一份数据在不同用户的设备上显示不同的日期。
   *
   * 注意：这条测试本身无法在所有时区下都抓住回归（跑在 UTC+8 时，
   * 错误实现也会得到正确结果）。真正的守门人是「实现完全不碰 Date 解析」
   * 这件事本身，下面通过 parseDateOnly 直接断言这一点。
   */
  it('按字符串拆解，不经过 Date 解析', () => {
    expect(parseDateOnly('2026-10-01')).toEqual({ year: 2026, month: 10, day: 1 })
    expect(parseDateOnly('2026-01-09')).toEqual({ year: 2026, month: 1, day: 9 })
  })

  it('非法输入直接报错，而不是悄悄得到一个错误日期', () => {
    expect(() => parseDateOnly('2026/10/01')).toThrow()
    expect(() => parseDateOnly('2026-10')).toThrow()
    expect(() => parseDateOnly('')).toThrow()
  })

  it('月初与月末都正确', () => {
    expect(formatActivityDate('2026-10-01')).toBe('10月1日 周四')
    expect(formatActivityDate('2026-10-31')).toBe('10月31日 周六')
  })

  it('跨年边界正确', () => {
    expect(formatActivityDate('2026-12-31')).toBe('12月31日 周四')
    expect(formatActivityDate('2027-01-01')).toBe('1月1日 周五')
  })

  it('长格式带年份', () => {
    expect(formatActivityDateLong('2026-10-01')).toBe('2026年10月1日')
  })

  it('同一活动日在任意时区下都解析成同一天', () => {
    // parseDateOnly 与 formatActivityDate 都不读时区，因此结果恒定。
    // 若将来有人改成 new Date(date)，这条会开始随运行环境漂移。
    const samples = ['2026-01-01', '2026-06-15', '2026-12-31']
    for (const date of samples) {
      const parts = parseDateOnly(date)
      expect(formatActivityDate(date)).toContain(`${parts.month}月${parts.day}日`)
    }
  })
})

describe('时间戳按北京时间展示', () => {
  it('UTC 时间戳换算到 +08:00', () => {
    // 2026-09-15T13:25:00Z === 北京时间 21:25
    expect(formatCst('2026-09-15T13:25:00Z', 'HH:mm')).toBe('21:25')
    expect(formatCst('2026-09-15T13:25:00Z')).toBe('2026-09-15 21:25')
  })

  it('跨日的时间戳按北京时间归到次日', () => {
    // 16:30Z 在北京是次日的 00:30
    expect(formatCst('2026-09-30T16:30:00Z')).toBe('2026-10-01 00:30')
  })

  it('不受运行环境时区影响', () => {
    // 实现里用的是 dayjs.utc().utcOffset(8)，与浏览器本地时区无关
    const iso = '2026-01-01T00:00:00Z'
    expect(formatCst(iso, 'HH:mm')).toBe('08:00')
  })
})

describe('剩余时间文案', () => {
  it('超过一小时显示小时与分钟', () => {
    expect(formatRemaining(3 * 3600 + 12 * 60)).toBe('3 小时 12 分')
  })

  it('不满一小时显示分钟与秒', () => {
    expect(formatRemaining(12 * 60 + 30)).toBe('12 分 30 秒')
    expect(formatRemaining(45)).toBe('45 秒')
  })

  it('已过截止返回已截止', () => {
    expect(formatRemaining(0)).toBe('已截止')
    expect(formatRemaining(-10)).toBe('已截止')
  })
})

describe('积分格式化', () => {
  it('毫点转展示值，去掉多余的零', () => {
    expect(formatMilli(1000)).toBe('1')
    expect(formatMilli(1500)).toBe('1.5')
    expect(formatMilli(2000)).toBe('2')
    expect(formatMilli(1250)).toBe('1.25')
    expect(formatMilli(1001)).toBe('1.001')
  })

  it('零与负数', () => {
    expect(formatMilli(0)).toBe('0')
    expect(formatMilli(-500)).toBe('-0.5')
    expect(formatMilli(-1000)).toBe('-1')
  })

  it('往返转换保持精度', () => {
    for (const milli of [0, 1, 999, 1000, 1500, 12345, -700]) {
      expect(parsePointsToMilli(formatMilli(milli))).toBe(milli)
    }
  })

  it('非法输入抛错而不是得到 NaN', () => {
    expect(() => parsePointsToMilli('abc')).toThrow()
    expect(() => parsePointsToMilli(Number.NaN)).toThrow()
  })

  it('排行榜展示值保留三位小数', () => {
    expect(formatScore(8.6666)).toBe('8.667')
    expect(formatScore(8)).toBe('8')
  })
})

describe('幂等键', () => {
  it('每次调用都不同 —— 固定值会让第二次提交被当成重复而静默返回旧版本', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newClientToken()))
    expect(tokens.size).toBe(50)
  })

  it('足够长，满足服务端 8 位下限', () => {
    expect(newClientToken().length).toBeGreaterThanOrEqual(8)
  })
})
