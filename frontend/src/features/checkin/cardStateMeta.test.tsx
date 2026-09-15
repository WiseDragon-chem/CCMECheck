import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { TodayCard } from '@/api/types'
import { CARD_STATE_META, actionFor, resolveCardDisplayState, type CardDisplayState } from './cardStateMeta'

/** 造一张卡片，只关心与状态判定相关的字段 */
function card(overrides: Partial<TodayCard>): TodayCard {
  return {
    track_id: 't1',
    slug: 'reading',
    name: '读书',
    icon: 'book',
    proof_instructions: null,
    card_state: 'can_submit',
    can_submit: true,
    entry_id: null,
    status: null,
    rejection_reason: null,
    rejection_code: null,
    submitted_at: null,
    reviewed_at: null,
    valid_days: 0,
    track_score: 0,
    daily_points: 1000,
    daily_cap: null,
    campaign_cap: null,
    overall_weight: 1000,
    ...overrides,
  }
}

const ALL_STATES = Object.keys(CARD_STATE_META) as CardDisplayState[]

/** 取图标元素的组件类型，用于判断两个状态是否用了同一个图标 */
function iconType(state: CardDisplayState): unknown {
  const element = CARD_STATE_META[state].icon as ReactElement
  return element.type
}

describe('卡片状态的展示元数据', () => {
  /**
   * design.md §7.3 要求卡片状态**同时**通过颜色、图标和文字表达，
   * 保障色觉障碍用户也能识别。
   *
   * 这一组断言是那条要求在本项目里的守门人：谁把两个状态改成一样的
   * 文字或图标，CI 立刻红。没有它，无障碍要求会在某次「顺手改改文案」
   * 里悄悄失效，而且不会有任何人发现。
   */
  it('九种状态的文字两两不同', () => {
    const labels = ALL_STATES.map((state) => CARD_STATE_META[state].label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('九种状态的图标两两不同', () => {
    const icons = ALL_STATES.map(iconType)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('不存在两个状态同时共用颜色和图标 —— 那样灰度下就分不清了', () => {
    for (const a of ALL_STATES) {
      for (const b of ALL_STATES) {
        if (a >= b) continue
        const sameColor = CARD_STATE_META[a].color === CARD_STATE_META[b].color
        const sameIcon = iconType(a) === iconType(b)
        expect(sameColor && sameIcon, `${a} 与 ${b} 的颜色和图标都相同`).toBe(false)
      }
    }
  })

  it('每种状态都有非空文字与颜色', () => {
    for (const state of ALL_STATES) {
      expect(CARD_STATE_META[state].label.length, state).toBeGreaterThan(0)
      expect(CARD_STATE_META[state].color, state).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('无操作的状态不给出按钮，否则用户点了也没反应', () => {
    for (const state of ['before_open', 'submit_closed', 'missed'] as const) {
      expect(actionFor(card({}), state), state).toBeNull()
    }
  })
})

describe('可用操作', () => {
  it('未打卡时给「去打卡」', () => {
    expect(actionFor(card({ card_state: 'can_submit', can_submit: true }), 'can_submit')).toBe('submit')
  })

  it('已驳回且未截止时给「重新提交」', () => {
    expect(actionFor(card({ card_state: 'rejected', can_submit: true }), 'rejected_open')).toBe('resubmit')
  })

  it('待审核在截止前可重新提交，截止后只能查看', () => {
    // §7.3 的状态表里，「待审核」一行的可用操作写的是「截止前可重新提交」。
    // 展示文案相同、操作不同，所以不能用一张静态表决定按钮。
    expect(actionFor(card({ card_state: 'pending', can_submit: true }), 'pending')).toBe('resubmit')
    expect(actionFor(card({ card_state: 'pending', can_submit: false }), 'pending')).toBe('detail')
  })

  it('已通过、已失效给出「查看详情」', () => {
    expect(actionFor(card({ card_state: 'approved' }), 'approved')).toBe('detail')
    expect(actionFor(card({ card_state: 'invalid' }), 'invalid')).toBe('detail')
    expect(actionFor(card({ card_state: 'rejected', can_submit: false }), 'rejected_closed')).toBe('detail')
  })
})

describe('展示状态推导', () => {
  it('后端状态直接映射的部分', () => {
    const cases: Array<[TodayCard['card_state'], string]> = [
      ['before_open', 'before_open'],
      ['pending', 'pending'],
      ['approved', 'approved'],
      ['missed', 'missed'],
      ['invalid', 'invalid'],
    ]
    for (const [cardState, expected] of cases) {
      expect(resolveCardDisplayState(card({ card_state: cardState }), 'active'), cardState).toBe(expected)
    }
  })

  it('rejected 按 can_submit 分成两种 —— 这是设计文档状态表没区分的地方', () => {
    // §7.3 把它们列为「已驳回且未截止」与「已驳回且已截止」两种，
    // 但只给了一个 card_state，区分依据是能否重新提交
    expect(resolveCardDisplayState(card({ card_state: 'rejected', can_submit: true }), 'active')).toBe(
      'rejected_open',
    )
    expect(resolveCardDisplayState(card({ card_state: 'rejected', can_submit: false }), 'active')).toBe(
      'rejected_closed',
    )
  })

  it('窗口开着但活动停止提交时，单独成为一种状态', () => {
    // 后端修复后 can_submit 会考虑活动状态，于是会出现
    // card_state='can_submit' 而 can_submit=false 的组合。
    // 若直接显示「今日尚未打卡」，用户会以为还能打卡。
    const stopped = card({ card_state: 'can_submit', can_submit: false })
    expect(resolveCardDisplayState(stopped, 'settling')).toBe('submit_closed')
    expect(CARD_STATE_META.submit_closed.label).toBe('活动已停止提交')
  })

  it('活动进行中且窗口开着时才是可提交', () => {
    expect(resolveCardDisplayState(card({ card_state: 'can_submit', can_submit: true }), 'active')).toBe(
      'can_submit',
    )
  })

  it('遇到没见过的 card_state 时降级为「未完成」而不是崩溃', () => {
    // 契约新增了状态而前端没跟上。宁可显示一个保守的值，
    // 也不要因为一个未映射的字符串让整页白屏。
    const unknown = card({ card_state: 'brand_new_state' as TodayCard['card_state'] })
    expect(() => resolveCardDisplayState(unknown, 'active')).not.toThrow()
    expect(resolveCardDisplayState(unknown, 'active')).toBe('missed')
  })
})
