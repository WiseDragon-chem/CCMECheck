import { describe, expect, it } from 'vitest'
import { OVERALL_TRACK_SENTINEL } from '../../src/config/constants.js'
import {
  assignRanks,
  compareRanking,
  computeParticipantScore,
  computeTrackScore,
  type RankableRow,
  type ScoringAdjustment,
  type ScoringEntry,
  type TrackScoringConfig,
} from '../../src/services/scoring.service.js'

/**
 * 计分引擎是纯函数（design.md §9.1、§9.3）。
 * 排行榜、每日快照、CSV 导出共用这一份实现，所以这里覆盖的边界
 * 直接决定 §16.7 与 §16.16 是否成立。
 *
 * 单位约定：积分是整数毫点（1000 = 1 分），权重是整数千分比（1000 = 1.0）。
 * 用整数而不是小数，是为了让「同分并列」的判定可复现。
 */

function config(overrides: Partial<TrackScoringConfig> = {}): TrackScoringConfig {
  return {
    trackId: 'track-reading',
    slug: 'reading',
    dailyPoints: 1000,
    dailyCap: null,
    campaignCap: null,
    overallWeight: 1000,
    enabled: true,
    ...overrides,
  }
}

function entry(activityDate: string, reviewedAt: string | null = `${activityDate}T12:00:00Z`, slug = 'reading'): ScoringEntry {
  return {
    trackSlug: slug,
    activityDate,
    reviewedAt: reviewedAt ? new Date(reviewedAt) : null,
  }
}

function adjustment(pointsDelta: number, createdAt: string, slug = 'reading'): ScoringAdjustment {
  return { trackSlug: slug, pointsDelta, createdAt: new Date(createdAt) }
}

describe('赛道计分', () => {
  it('每条通过记录按每日分值累加', () => {
    const result = computeTrackScore({
      config: config(),
      entries: [entry('2026-10-01'), entry('2026-10-02'), entry('2026-10-03')],
      adjustments: [],
    })

    expect(result.score).toBe(3000)
    expect(result.validDays).toBe(3)
  })

  it('没有通过记录时得分为 0，且没有达到时间', () => {
    const result = computeTrackScore({ config: config(), entries: [], adjustments: [] })
    expect(result.score).toBe(0)
    expect(result.validDays).toBe(0)
    expect(result.reachedAt).toBeNull()
  })

  it('每日上限约束当天的得分', () => {
    const result = computeTrackScore({
      config: config({ dailyPoints: 2000, dailyCap: 1500 }),
      entries: [entry('2026-10-01'), entry('2026-10-02')],
      adjustments: [],
    })

    // 每天被压到 1500，两天共 3000
    expect(result.score).toBe(3000)
  })

  it('活动总上限约束打卡挣来的分', () => {
    const result = computeTrackScore({
      config: config({ campaignCap: 2500 }),
      entries: [entry('2026-10-01'), entry('2026-10-02'), entry('2026-10-03')],
      adjustments: [],
    })

    expect(result.earned).toBe(2500)
    expect(result.score).toBe(2500)
    // 有效天数仍然是真实打卡天数，不受上限影响
    expect(result.validDays).toBe(3)
  })

  it('人工调整不受活动上限约束，否则管理员加分会被静默吃掉', () => {
    const result = computeTrackScore({
      config: config({ campaignCap: 1000 }),
      entries: [entry('2026-10-01'), entry('2026-10-02')],
      adjustments: [adjustment(500, '2026-10-05T00:00:00Z')],
    })

    expect(result.earned).toBe(1000)
    expect(result.score).toBe(1500)
  })

  it('人工调整可以为负（扣分）', () => {
    const result = computeTrackScore({
      config: config(),
      entries: [entry('2026-10-01')],
      adjustments: [adjustment(-400, '2026-10-05T00:00:00Z')],
    })

    expect(result.score).toBe(600)
  })

  it('达到积分的时间取累计首次达标的时刻', () => {
    const result = computeTrackScore({
      config: config(),
      entries: [
        // 故意乱序传入，引擎内部按审核时间升序累加
        entry('2026-10-03', '2026-10-03T10:00:00Z'),
        entry('2026-10-01', '2026-10-01T10:00:00Z'),
        entry('2026-10-02', '2026-10-02T10:00:00Z'),
      ],
      adjustments: [],
    })

    expect(result.reachedAt?.toISOString()).toBe('2026-10-03T10:00:00.000Z')
  })

  it('人工调整发生在计分之后时，达到时间取更晚的那个', () => {
    const result = computeTrackScore({
      config: config(),
      entries: [entry('2026-10-01', '2026-10-01T10:00:00Z')],
      adjustments: [adjustment(200, '2026-10-09T08:00:00Z')],
    })

    expect(result.reachedAt?.toISOString()).toBe('2026-10-09T08:00:00.000Z')
  })

  it('同一天同一赛道出现多条记录时仍只算一天', () => {
    const result = computeTrackScore({
      config: config(),
      entries: [entry('2026-10-01'), entry('2026-10-01')],
      adjustments: [],
    })

    expect(result.validDays).toBe(1)
    expect(result.score).toBe(1000)
  })
})

describe('参与者总分', () => {
  const configs = [
    config({ slug: 'reading', overallWeight: 1000 }),
    config({ trackId: 'track-vocabulary', slug: 'vocabulary', overallWeight: 500 }),
    config({ trackId: 'track-fitness', slug: 'fitness', overallWeight: 2000 }),
  ]

  it('总分为各赛道加权和（整数千分比，单次舍入）', () => {
    const result = computeParticipantScore({
      participantId: 'p1',
      configs,
      input: {
        participantId: 'p1',
        entries: [
          entry('2026-10-01', undefined, 'reading'),
          entry('2026-10-01', undefined, 'vocabulary'),
          entry('2026-10-01', undefined, 'fitness'),
        ],
        adjustments: [],
      },
    })

    // 赛道分本身不受权重影响：三个赛道各 1 条记录 × 1000 毫点
    expect(result.tracks.get('reading')!.score).toBe(1000)
    expect(result.tracks.get('vocabulary')!.score).toBe(1000)
    expect(result.tracks.get('fitness')!.score).toBe(1000)

    // 权重只体现在总榜：1000×1.0 + 1000×0.5 + 1000×2.0 = 3500 毫点
    expect(result.totalScore).toBe(3500)
  })

  it('权重为 0 的赛道不计入总榜，但仍然单独计分', () => {
    const result = computeParticipantScore({
      participantId: 'p1',
      configs: [config({ slug: 'reading', overallWeight: 0 })],
      input: { participantId: 'p1', entries: [entry('2026-10-01')], adjustments: [] },
    })

    expect(result.totalScore).toBe(0)
    expect(result.tracks.get('reading')!.score).toBe(1000)
  })

  it('总榜有效天数是跨赛道去重后的活动日数', () => {
    const result = computeParticipantScore({
      participantId: 'p1',
      configs,
      input: {
        participantId: 'p1',
        entries: [
          entry('2026-10-01', undefined, 'reading'),
          entry('2026-10-01', undefined, 'vocabulary'),
          entry('2026-10-02', undefined, 'reading'),
        ],
        adjustments: [],
      },
    })

    // 同一天跨赛道只算一个有效日
    expect(result.totalValidDays).toBe(2)
  })

  it('总榜哨兵值上的调整直接加在总分上', () => {
    const result = computeParticipantScore({
      participantId: 'p1',
      configs,
      input: {
        participantId: 'p1',
        entries: [entry('2026-10-01', undefined, 'reading')],
        adjustments: [adjustment(700, '2026-10-10T00:00:00Z', OVERALL_TRACK_SENTINEL)],
      },
    })

    expect(result.totalScore).toBe(1700)
  })

  it('非整比权重不会产生浮点尾差', () => {
    // 1000 × 0.333 = 333（整数千分比 333/1000）
    const result = computeParticipantScore({
      participantId: 'p1',
      configs: [config({ slug: 'reading', overallWeight: 333 })],
      input: { participantId: 'p1', entries: [entry('2026-10-01')], adjustments: [] },
    })

    expect(result.totalScore).toBe(333)
    expect(Number.isInteger(result.totalScore)).toBe(true)
  })
})

describe('排序与并列（§9.3）', () => {
  /**
   * 设计好的对照数据，让每个排序键都恰好成为某一对的唯一区分因素：
   *   a 与 b 同分不同有效天数        → ② 有效天数降序
   *   b 与 c 同分同天数不同达到时间  → ③ 达到时间升序
   *   d 分低但有效天数高             → 验证 ① 优先级最高
   */
  const rows: RankableRow[] = [
    { participantId: 'a', score: 3000, validDays: 3, reachedAt: new Date('2026-10-03T10:00:00Z') },
    { participantId: 'b', score: 3000, validDays: 4, reachedAt: new Date('2026-10-04T10:00:00Z') },
    { participantId: 'c', score: 3000, validDays: 4, reachedAt: new Date('2026-10-02T10:00:00Z') },
    { participantId: 'd', score: 1000, validDays: 9, reachedAt: new Date('2026-10-01T10:00:00Z') },
  ]

  const order = () => [...rows].sort(compareRanking).map((row) => row.participantId)

  it('① 积分降序优先于其他所有键', () => {
    // d 的有效天数最多、达到时间最早，但分最低，仍排在最后
    expect(order()).toEqual(['c', 'b', 'a', 'd'])
  })

  it('② 同分比有效天数降序', () => {
    // a 与 b 同为 3000 分，b 有效天数 4 天 > a 的 3 天
    expect(order().indexOf('b')).toBeLessThan(order().indexOf('a'))
  })

  it('③ 同分同天数比达到积分时间升序', () => {
    // b 与 c 同分同天数，c 在 10-02 更早达到
    expect(order().indexOf('c')).toBeLessThan(order().indexOf('b'))
  })

  it('前三项全同才算并列，④ 稳定标识只决定展示顺序', () => {
    const tied: RankableRow[] = [
      { participantId: 'z', score: 1000, validDays: 1, reachedAt: new Date('2026-10-01T10:00:00Z') },
      { participantId: 'a', score: 1000, validDays: 1, reachedAt: new Date('2026-10-01T10:00:00Z') },
    ]
    const sorted = [...tied].sort(compareRanking)
    expect(sorted.map((row) => row.participantId)).toEqual(['a', 'z'])

    // 并列，名次相同，后一名跳号
    expect(assignRanks(sorted)).toEqual([1, 1])
  })

  it('标准竞赛排名：同分同名次、后续跳号', () => {
    const ranked: RankableRow[] = [
      { participantId: 'a', score: 3000, validDays: 3, reachedAt: null },
      { participantId: 'b', score: 3000, validDays: 3, reachedAt: null },
      { participantId: 'c', score: 2000, validDays: 2, reachedAt: null },
      { participantId: 'd', score: 1000, validDays: 1, reachedAt: null },
    ]

    expect(assignRanks(ranked)).toEqual([1, 1, 3, 4])
  })

  it('没有任何记录时未达到时间为 null，排序不崩溃', () => {
    const ranked: RankableRow[] = [
      { participantId: 'b', score: 0, validDays: 0, reachedAt: null },
      { participantId: 'a', score: 0, validDays: 0, reachedAt: null },
    ]
    const sorted = [...ranked].sort(compareRanking)
    expect(assignRanks(sorted)).toEqual([1, 1])
  })
})
