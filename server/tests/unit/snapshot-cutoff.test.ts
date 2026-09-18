import { describe, expect, it } from 'vitest'
import { resolveCronCutoffDate, resolveExpectedCutoffDate } from '../../src/services/snapshot.service.js'

/**
 * 「此刻本该有的快照统计截止日」的纯函数用例。
 *
 * 全部显式传 now，不走 freezeTimeAt —— 后者是假计时器 + 真实时间漂移，
 * 而这里要断言的恰恰是到点前/后那一分钟的边界。
 *
 * 活动窗口固定 2026-10-01 ~ 2026-10-07，排行榜时间 06:00。
 */
const CAMPAIGN = {
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  leaderboardTime: '06:00',
}

/** 北京时间瞬时，避免到处写 +08:00 */
function at(dateTime: string): Date {
  return new Date(`${dateTime}+08:00`)
}

describe('resolveExpectedCutoffDate', () => {
  it('到点之前，最新一份仍是前一天的产物（今天 - 2）', () => {
    // 10-04 的 06:00 那轮还没到，此时应有的最新快照是 10-03 06:00 产出的 10-02
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T05:59:00'))).toBe('2026-10-02')
  })

  it('到点那一刻起改用今天 - 1', () => {
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T06:00:00'))).toBe('2026-10-03')
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T23:59:00'))).toBe('2026-10-03')
  })

  it('跨过北京时间零点不能把截止日往前推（进程半夜启动的补跑就靠这条）', () => {
    // 10-04 00:30 已经过了零点，但 10-04 的那轮还没跑，应有的最新仍是 10-02
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T00:30:00'))).toBe('2026-10-02')
  })

  it('排行榜时间不是整点时按真实时刻判断', () => {
    const campaign = { ...CAMPAIGN, leaderboardTime: '06:30' }
    expect(resolveExpectedCutoffDate(campaign, at('2026-10-04T06:29:00'))).toBe('2026-10-02')
    expect(resolveExpectedCutoffDate(campaign, at('2026-10-04T06:30:00'))).toBe('2026-10-03')
  })

  it('早于活动开始日没有任何该产出的快照', () => {
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-01T05:59:00'))).toBeNull()
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-01T06:00:00'))).toBeNull()
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-02T05:00:00'))).toBeNull()
  })

  it('统计截止日不超过活动结束日', () => {
    // 结束日当天到点前仍是 10-05，到点后是 10-06
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-07T05:00:00'))).toBe('2026-10-05')
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-07T06:00:00'))).toBe('2026-10-06')
    // 活动早结束后封顶到结束日，不会算出 11-19 这种日期
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-11-20T06:00:00'))).toBe('2026-10-07')
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-11-20T03:00:00'))).toBe('2026-10-07')
  })
})

describe('resolveExpectedCutoffDate 与 resolveCronCutoffDate 的关系', () => {
  it('整点排行榜时间的到点时刻两者恒等，到点前只有前者退一天', () => {
    const campaign = { startDate: CAMPAIGN.startDate, endDate: CAMPAIGN.endDate }

    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T06:00:00'))).toBe(
      resolveCronCutoffDate(campaign, at('2026-10-04T06:00:00')),
    )
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T18:00:00'))).toBe(
      resolveCronCutoffDate(campaign, at('2026-10-04T18:00:00')),
    )

    // 到点前：任务口径说「该生成 10-03」，但此刻应有的最新一份还是 10-02
    expect(resolveCronCutoffDate(campaign, at('2026-10-04T05:00:00'))).toBe('2026-10-03')
    expect(resolveExpectedCutoffDate(CAMPAIGN, at('2026-10-04T05:00:00'))).toBe('2026-10-02')
  })
})
