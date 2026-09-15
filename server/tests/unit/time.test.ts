import { describe, expect, it } from 'vitest'
import {
  addDays,
  compareDateOnly,
  cstInstantOf,
  cstToday,
  deadlineInstant,
  diffDays,
  enumerateDates,
  isDateOnly,
  isSubmissionAllowed,
  isTimeOfDay,
  toActivityDate,
  truncateToSecond,
  windowState,
} from '../../src/core/time.js'

/**
 * design.md §6.2：服务器统一保存 UTC，activity_date 单独保存为 YYYY-MM-DD，
 * 且所有换算按固定 +08:00，不依赖时区数据库。
 */
describe('北京时间算术', () => {
  describe('toActivityDate', () => {
    it('北京时间零点整归属到新的一天', () => {
      // 2026-10-01 00:00:00 +08:00 === 2026-09-30 16:00:00 UTC
      expect(toActivityDate(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01')
    })

    it('北京时间零点前一秒仍属于前一天', () => {
      expect(toActivityDate(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09-30')
    })

    it('跨月边界正确', () => {
      expect(toActivityDate(new Date('2026-10-31T16:00:00Z'))).toBe('2026-11-01')
      expect(toActivityDate(new Date('2026-10-31T15:59:59Z'))).toBe('2026-10-31')
    })

    it('跨年边界正确', () => {
      expect(toActivityDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
      expect(toActivityDate(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    })

    it('结果不随进程时区变化（测试套件会在 TZ=America/Los_Angeles 下再跑一遍）', () => {
      // 洛杉矶时区下这个瞬时是 09:00，北京时间是次日 00:00
      expect(toActivityDate(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01')
      expect(process.env.TZ ?? '').toBe(process.env.TZ ?? '')
    })
  })

  describe('addDays / diffDays / enumerateDates', () => {
    it('跨月加减', () => {
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
      expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    })

    it('跨年加减', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    })

    it('闰年二月', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
      expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    })

    it('diffDays 跨月跨年', () => {
      expect(diffDays('2026-10-31', '2026-11-01')).toBe(1)
      expect(diffDays('2026-12-31', '2027-01-01')).toBe(1)
      expect(diffDays('2026-10-01', '2026-10-07')).toBe(6)
    })

    it('enumerateDates 含首尾', () => {
      expect(enumerateDates('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
      expect(enumerateDates('2026-10-01', '2026-10-01')).toEqual(['2026-10-01'])
    })
  })

  describe('日期与时间格式校验', () => {
    it('接受合法日期', () => {
      expect(isDateOnly('2026-10-01')).toBe(true)
      expect(isDateOnly('2028-02-29')).toBe(true)
    })

    it('拒绝日历上不存在的日期', () => {
      expect(isDateOnly('2026-02-30')).toBe(false)
      expect(isDateOnly('2026-13-01')).toBe(false)
      expect(isDateOnly('2026-00-10')).toBe(false)
    })

    it('拒绝格式不对的字符串', () => {
      expect(isDateOnly('2026/10/01')).toBe(false)
      expect(isDateOnly('26-10-01')).toBe(false)
      expect(isDateOnly('')).toBe(false)
    })

    it('时间格式校验', () => {
      expect(isTimeOfDay('00:00')).toBe(true)
      expect(isTimeOfDay('23:59')).toBe(true)
      expect(isTimeOfDay('24:00')).toBe(false)
      expect(isTimeOfDay('9:5')).toBe(false)
    })
  })

  describe('截止时刻换算', () => {
    it('北京时间 23:59 对应 UTC 15:59', () => {
      expect(deadlineInstant('2026-10-01', '23:59').toISOString()).toBe('2026-10-01T15:59:00.000Z')
    })

    it('北京时间 00:00 对应前一日 UTC 16:00', () => {
      expect(cstInstantOf('2026-10-01', '00:00').toISOString()).toBe('2026-09-30T16:00:00.000Z')
    })
  })

  describe('提交时间窗', () => {
    const window = { dailyOpenTime: '06:00', dailyDeadline: '23:00' }

    it('开放前、开放中、截止后三态', () => {
      expect(windowState('2026-10-01', window.dailyOpenTime, window.dailyDeadline, new Date('2026-09-30T21:00:00Z'))).toBe('before_open')
      expect(windowState('2026-10-01', window.dailyOpenTime, window.dailyDeadline, new Date('2026-10-01T04:00:00Z'))).toBe('open')
      expect(windowState('2026-10-01', window.dailyOpenTime, window.dailyDeadline, new Date('2026-10-01T15:30:00Z'))).toBe('after_deadline')
    })

    it('截止瞬间仍算开放，过一秒即关闭', () => {
      // 23:00 +08:00 === 15:00 UTC
      const atDeadline = new Date('2026-10-01T15:00:00Z')
      const afterDeadline = new Date('2026-10-01T15:00:01Z')

      expect(isSubmissionAllowed({ activityDate: '2026-10-01', ...window, now: atDeadline })).toBe(true)
      expect(isSubmissionAllowed({ activityDate: '2026-10-01', ...window, now: afterDeadline })).toBe(false)
    })

    it('管理员重开在有效期内放宽截止，过期后重新关闭', () => {
      const now = new Date('2026-10-02T10:00:00Z') // 活动日 10-01 的次日

      // 没有重开：已截止
      expect(isSubmissionAllowed({ activityDate: '2026-10-01', ...window, now })).toBe(false)

      // 重开到 now 之后：放行
      expect(
        isSubmissionAllowed({
          activityDate: '2026-10-01',
          ...window,
          now,
          reopenExpiresAt: new Date('2026-10-02T11:00:00Z'),
        }),
      ).toBe(true)

      // 重开已过期：重新关闭
      expect(
        isSubmissionAllowed({
          activityDate: '2026-10-01',
          ...window,
          now,
          reopenExpiresAt: new Date('2026-10-02T09:00:00Z'),
        }),
      ).toBe(false)
    })

    it('重开不能提前开放尚未开始的活动日', () => {
      const now = new Date('2026-09-30T10:00:00Z') // 10-01 尚未开放
      expect(
        isSubmissionAllowed({
          activityDate: '2026-10-01',
          ...window,
          now,
          reopenExpiresAt: new Date('2026-10-05T00:00:00Z'),
        }),
      ).toBe(false)
    })
  })

  describe('truncateToSecond', () => {
    it('去掉毫秒，避免同秒签发的令牌被误判为过期', () => {
      expect(truncateToSecond(new Date('2026-10-01T10:00:00.987Z')).toISOString()).toBe('2026-10-01T10:00:00.000Z')
    })
  })

  describe('cstToday / compareDateOnly', () => {
    it('cstToday 等价于 toActivityDate(now)', () => {
      const now = new Date('2026-10-01T02:00:00Z')
      expect(cstToday(now)).toBe(toActivityDate(now))
    })

    it('字典序即时间序', () => {
      expect(compareDateOnly('2026-10-01', '2026-10-02')).toBe(-1)
      expect(compareDateOnly('2026-10-02', '2026-10-01')).toBe(1)
      expect(compareDateOnly('2026-10-01', '2026-10-01')).toBe(0)
      expect(['2026-10-03', '2026-10-01', '2026-10-02'].sort(compareDateOnly)).toEqual([
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
      ])
    })
  })
})
