import { describe, expect, it } from 'vitest'
import {
  FITNESS_EXERCISE_TYPES,
  TIER2_MULTIPLIER,
  WORD_COUNT_MIN,
  WORD_COUNT_TIER2,
  dailyCapTierProblem,
  judgePoints,
  resolveDeclaration,
  type CheckinDeclaration,
  type DeclarationInput,
} from '../../src/services/judge.service.js'

/**
 * 打卡分值判定（design.md §9.1）。
 *
 * 梯度表本身是这个功能的规格说明，所以边界（29 / 30 / 49 / 50）逐个钉在这里。
 * 更重要的是**兜底必须相对 basePoints**：管理员可以把赛道的 daily_points 调成别的值，
 * 写死 1000 会让 CSV 导出与排行榜对不上（§16.16），所以最后单独锁一条。
 */

const declaration = (overrides: Partial<CheckinDeclaration> = {}): CheckinDeclaration => ({
  wordCount: null,
  exerciseType: null,
  ...overrides,
})

/** 一千毫点 = 1 分 */
const ONE = 1000

describe('单词赛道：按背诵数量分档', () => {
  const points = (wordCount: number | null, basePoints = ONE) =>
    judgePoints({ trackSlug: 'vocabulary', declaration: declaration({ wordCount }), basePoints })

  it('30 个是下限，记 1 分', () => {
    expect(points(WORD_COUNT_MIN)).toBe(ONE)
  })

  it('30 到 49 之间记 1 分', () => {
    expect(points(31)).toBe(ONE)
    expect(points(49)).toBe(ONE)
    expect(points(WORD_COUNT_TIER2 - 1)).toBe(ONE)
  })

  it('50 个起记 2 分', () => {
    expect(points(WORD_COUNT_TIER2)).toBe(ONE * TIER2_MULTIPLIER)
    expect(points(500)).toBe(ONE * TIER2_MULTIPLIER)
  })

  it('数量缺失或不是正整数时回退到基础分', () => {
    // 小于下限的值本不该落库（提交时就拒了），真出现时按基础分算
    expect(points(null)).toBe(ONE)
    expect(points(0)).toBe(ONE)
    expect(points(29)).toBe(ONE)
    expect(points(30.5)).toBe(ONE)
  })

  it('误传的运动类型不影响单词赛道的判定', () => {
    const result = judgePoints({
      trackSlug: 'vocabulary',
      declaration: declaration({ wordCount: 50, exerciseType: 'workout_60min' }),
      basePoints: ONE,
    })

    expect(result).toBe(ONE * TIER2_MULTIPLIER)
  })
})

describe('运动赛道：按运动类型分档', () => {
  const points = (exerciseType: string | null, basePoints = ONE) =>
    judgePoints({ trackSlug: 'fitness', declaration: declaration({ exerciseType }), basePoints })

  it('>2km 跑步与一般运动 30 分钟记 1 分', () => {
    expect(points('run_gt_2km')).toBe(ONE)
    expect(points('workout_30min')).toBe(ONE)
  })

  it('>3km 跑步与一般运动 60 分钟记 2 分', () => {
    expect(points('run_gt_3km')).toBe(ONE * TIER2_MULTIPLIER)
    expect(points('workout_60min')).toBe(ONE * TIER2_MULTIPLIER)
  })

  it('每个选项都能判定，没有落空的分支', () => {
    for (const type of FITNESS_EXERCISE_TYPES) {
      expect(points(type)).toBeGreaterThan(0)
    }
  })

  it('类型缺失或不认识时回退到基础分', () => {
    expect(points(null)).toBe(ONE)
    expect(points('run_2km')).toBe(ONE)
    expect(points('跑步')).toBe(ONE)
  })

  it('误传的单词数量不影响运动赛道的判定', () => {
    const result = judgePoints({
      trackSlug: 'fitness',
      declaration: declaration({ wordCount: 999, exerciseType: 'run_gt_2km' }),
      basePoints: ONE,
    })

    expect(result).toBe(ONE)
  })
})

describe('读书与兜底', () => {
  it('读书统一记基础分，与申报明细无关', () => {
    expect(judgePoints({ trackSlug: 'reading', declaration: null, basePoints: ONE })).toBe(ONE)
    expect(
      judgePoints({
        trackSlug: 'reading',
        declaration: declaration({ wordCount: 999, exerciseType: 'run_gt_3km' }),
        basePoints: ONE,
      }),
    ).toBe(ONE)
  })

  it('明细缺失（历史记录、补录）一律回退到基础分', () => {
    expect(judgePoints({ trackSlug: 'vocabulary', declaration: null, basePoints: ONE })).toBe(ONE)
    expect(judgePoints({ trackSlug: 'fitness', declaration: undefined, basePoints: ONE })).toBe(ONE)
  })

  it('未知赛道回退到基础分，不抛错', () => {
    expect(
      judgePoints({ trackSlug: 'some_future_track', declaration: declaration({ wordCount: 50 }), basePoints: ONE }),
    ).toBe(ONE)
  })

  /**
   * 这条是给 CSV 导出与排行榜的一致性上保险的（§16.16）：
   * export.test.ts 用 fitness: 500 这类非默认 daily_points 建数据并断言导出的分值，
   * 所以二档必须是 basePoints 的倍数，不能是字面量 2000。
   */
  it('二档相对赛道基础分，不是写死的 2000', () => {
    expect(judgePoints({ trackSlug: 'fitness', declaration: declaration({ exerciseType: 'run_gt_3km' }), basePoints: 500 }))
      .toBe(500 * TIER2_MULTIPLIER)
    expect(judgePoints({ trackSlug: 'vocabulary', declaration: declaration({ wordCount: 50 }), basePoints: 2000 }))
      .toBe(2000 * TIER2_MULTIPLIER)
  })
})

describe('每日上限与二档的关系', () => {
  /*
    上限有**两扇门**（配置与 PATCH /admin/campaigns/tracks/:trackId），
    这个函数是两边共用的那一份规则，所以它的边界要钉住。
  */
  it('分档赛道的上限低于两倍基础分值时给出原因', () => {
    expect(dailyCapTierProblem({ trackSlug: 'vocabulary', dailyPoints: ONE, dailyCap: 1000 })).toMatch(/每日上限/)
    expect(dailyCapTierProblem({ trackSlug: 'fitness', dailyPoints: 500, dailyCap: 999 })).toMatch(/每日上限/)
  })

  it('恰好两倍或更高没问题', () => {
    expect(dailyCapTierProblem({ trackSlug: 'vocabulary', dailyPoints: ONE, dailyCap: 2000 })).toBeNull()
    expect(dailyCapTierProblem({ trackSlug: 'fitness', dailyPoints: ONE, dailyCap: 5000 })).toBeNull()
  })

  it('不限上限没问题', () => {
    expect(dailyCapTierProblem({ trackSlug: 'vocabulary', dailyPoints: ONE, dailyCap: null })).toBeNull()
  })

  it('不分档的赛道怎么设都不管 —— 它没有被压掉的二档', () => {
    expect(dailyCapTierProblem({ trackSlug: 'reading', dailyPoints: ONE, dailyCap: 500 })).toBeNull()
    expect(dailyCapTierProblem({ trackSlug: 'some_future_track', dailyPoints: ONE, dailyCap: 1 })).toBeNull()
  })
})

describe('提交时的申报明细校验', () => {
  const resolve = (overrides: Partial<DeclarationInput> = {}) =>
    resolveDeclaration({
      trackSlug: 'vocabulary',
      wordCount: null,
      exerciseType: null,
      note: null,
      imageCount: 1,
      campaignMinImages: 1,
      ...overrides,
    })

  it('单词赛道少于下限直接拒绝', () => {
    expect(() => resolve({ wordCount: WORD_COUNT_MIN - 1 })).toThrowError(/30/)
    expect(() => resolve({ wordCount: 0 })).toThrowError()
    expect(() => resolve({ wordCount: null })).toThrowError()
    expect(() => resolve({ wordCount: 30.5 })).toThrowError()
  })

  it('单词赛道接受下限及以上，并丢弃误传的运动类型', () => {
    const result = resolve({ wordCount: WORD_COUNT_MIN, exerciseType: 'workout_60min' })

    expect(result.declaration).toEqual({ wordCount: WORD_COUNT_MIN, exerciseType: null })
    expect(result.minImages).toBe(1)
  })

  it('运动赛道必须四选一', () => {
    expect(() => resolve({ trackSlug: 'fitness', exerciseType: null })).toThrowError(/运动类型/)
    expect(() => resolve({ trackSlug: 'fitness', exerciseType: 'swimming' })).toThrowError(/运动类型/)
  })

  it('运动赛道接受四个选项，并丢弃误传的单词数量', () => {
    for (const exerciseType of FITNESS_EXERCISE_TYPES) {
      const result = resolve({ trackSlug: 'fitness', exerciseType, wordCount: 999 })

      expect(result.declaration).toEqual({ wordCount: null, exerciseType })
    }
  })

  it('读书赛道图片与备注至少有一个', () => {
    expect(() => resolve({ trackSlug: 'reading', imageCount: 0, note: null })).toThrowError(/备注/)
    expect(() => resolve({ trackSlug: 'reading', imageCount: 0, note: '   ' })).toThrowError(/备注/)
  })

  it('读书赛道只交备注也放行，且图片下限降为 0', () => {
    const result = resolve({ trackSlug: 'reading', imageCount: 0, note: '读了 30 页' })

    expect(result.minImages).toBe(0)
    expect(result.declaration).toEqual({ wordCount: null, exerciseType: null })
  })

  it('读书赛道只交图片也放行', () => {
    expect(resolve({ trackSlug: 'reading', imageCount: 1, note: null }).minImages).toBe(0)
  })

  it('其余赛道沿用活动配置的图片下限', () => {
    expect(resolve({ wordCount: 30, campaignMinImages: 2 }).minImages).toBe(2)
    expect(resolve({ trackSlug: 'fitness', exerciseType: 'run_gt_2km', campaignMinImages: 3 }).minImages).toBe(3)
  })
})
