import { describe, expect, it } from 'vitest'
import type { Track } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { explainScoring } from './scoringHint'

/**
 * 服务端默认的全等权赛道 —— 值与 server/src/config/campaign.ts 的
 * DEFAULT_TRACK_RULE 一致。这些用例其实是在钉住「说明文案与默认配置相符」，
 * 默认值改了而文案没改的话，这里会红。
 */
function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'trk_1',
    slug: 'reading',
    name: '读书',
    description: null,
    icon: null,
    proof_instructions: null,
    enabled: true,
    daily_points: 1000,
    daily_cap: null,
    campaign_cap: null,
    overall_weight: 1000,
    ...overrides,
  }
}

describe('explainScoring', () => {
  it('全等权时给出分档说明', () => {
    expect(explainScoring([track()])).toBe(zh.leaderboard.scoringRule(1))
  })

  it('赛道条数取自传入的赛道，一天三条就说三条', () => {
    const tracks = [
      track({ id: 'a', slug: 'reading' }),
      track({ id: 'b', slug: 'vocabulary' }),
      track({ id: 'c', slug: 'fitness' }),
    ]
    expect(explainScoring(tracks)).toBe(zh.leaderboard.scoringRule(3))
    expect(explainScoring(tracks)).toContain('3 条赛道')
  })

  it('停用的赛道不计入条数 —— 它不出现在榜单上，也不参与总榜', () => {
    const tracks = [
      track({ id: 'a', slug: 'reading' }),
      track({ id: 'b', slug: 'vocabulary' }),
      track({ id: 'c', slug: 'fitness', enabled: false }),
    ]
    expect(explainScoring(tracks)).toBe(zh.leaderboard.scoringRule(2))
  })

  // 下面每条都是「配置偏离了默认值」，此时不能再说「等权、1 分」——
  // 说错了比说得笼统更糟，所以一律退到不带数字的兜底文案。

  it('单次分值不是 1 分时退到兜底', () => {
    expect(explainScoring([track({ daily_points: 500 })])).toBe(zh.leaderboard.scoringFallback)
  })

  it('有单日上限时退到兜底', () => {
    expect(explainScoring([track({ daily_cap: 1000 })])).toBe(zh.leaderboard.scoringFallback)
  })

  it('有活动期上限时退到兜底', () => {
    expect(explainScoring([track({ campaign_cap: 5000 })])).toBe(zh.leaderboard.scoringFallback)
  })

  it('权重不是 1.0 时退到兜底', () => {
    expect(explainScoring([track({ overall_weight: 500 })])).toBe(zh.leaderboard.scoringFallback)
  })

  it('多个赛道里只要有一个不等权就整体退到兜底', () => {
    const tracks = [
      track({ id: 'a', slug: 'reading' }),
      track({ id: 'b', slug: 'vocabulary' }),
      track({ id: 'c', slug: 'fitness', overall_weight: 2000 }),
    ]
    expect(explainScoring(tracks)).toBe(zh.leaderboard.scoringFallback)
  })

  it('没有启用的赛道时退到兜底 —— 不说「一天 0 条赛道」这种话', () => {
    expect(explainScoring([track({ enabled: false })])).toBe(zh.leaderboard.scoringFallback)
  })

  it('赛道列表为空时退到兜底', () => {
    expect(explainScoring([])).toBe(zh.leaderboard.scoringFallback)
  })
})
