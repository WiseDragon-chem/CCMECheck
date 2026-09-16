import { describe, expect, it } from 'vitest'
import { shouldHandleKey, type KeyEventLike } from './useHotkeys'

/**
 * 该不该响应这次按键（design.md §8.2）。
 *
 * 三条守卫每一条都对应一次真实事故，而且都不是「提示不明显」那一类 ——
 * 它们会**静默地**改数据。所以这里逐条钉住，包括看起来最琐碎的输入法那条。
 */

const press = (overrides: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: 'a',
  ...overrides,
})

const INPUT = { tagName: 'INPUT' }
const TEXTAREA = { tagName: 'TEXTAREA' }
const SELECT = { tagName: 'SELECT' }
const EDITABLE = { tagName: 'DIV', isContentEditable: true }
const BODY = { tagName: 'BODY' }

describe('组合键', () => {
  it('Ctrl / Cmd / Alt 的组合留给浏览器，不抢', () => {
    // 抢了 Cmd+R 之类的键，审核员会在刷新页面时顺手审掉一条记录
    expect(shouldHandleKey(press({ ctrlKey: true }), BODY)).toBe(false)
    expect(shouldHandleKey(press({ metaKey: true }), BODY)).toBe(false)
    expect(shouldHandleKey(press({ altKey: true }), BODY)).toBe(false)
  })
})

describe('中文输入法', () => {
  it('输入法组合期间的按键不响应', () => {
    /**
     * 这是这一屏最可能出的生产事故：审核员开着输入法在驳回原因里打字，
     * 而 a / r / j / k 正是拼音里最常见的字母 —— 每敲一个 a 就通过一条记录，
     * 界面上不会有任何提示。
     */
    expect(shouldHandleKey(press({ key: 'a', isComposing: true }), INPUT)).toBe(false)
    // 有些浏览器不给 isComposing，但目标元素是输入框，同样被下面的守卫挡下
    expect(shouldHandleKey(press({ key: 'a' }), INPUT)).toBe(false)
  })

  it('组合期间即使焦点不在输入框里也不响应', () => {
    // 输入法的候选框有时会让焦点短暂离开输入框，此时 isComposing 是唯一的信号
    expect(shouldHandleKey(press({ key: 'a', isComposing: true }), BODY)).toBe(false)
  })
})

describe('输入框', () => {
  it('默认不在输入框里响应', () => {
    expect(shouldHandleKey(press({ key: 'j' }), INPUT)).toBe(false)
    expect(shouldHandleKey(press({ key: 'k' }), TEXTAREA)).toBe(false)
    expect(shouldHandleKey(press({ key: 'a' }), SELECT)).toBe(false)
    expect(shouldHandleKey(press({ key: 'r' }), EDITABLE)).toBe(false)
  })

  it('显式允许时才在输入框里响应 —— 只有 Esc 该开这个口子', () => {
    expect(shouldHandleKey(press({ key: 'Escape' }), INPUT, true)).toBe(true)
    // 但即便允许，输入法组合期间仍然不响应
    expect(shouldHandleKey(press({ key: 'Escape', isComposing: true }), INPUT, true)).toBe(false)
  })

  it('标签名大小写不影响判断', () => {
    // event.target.tagName 的实际大小写随文档类型而变，不能假定
    expect(shouldHandleKey(press({ key: 'a' }), { tagName: 'input' })).toBe(false)
  })

  it('没有目标元素（事件来自 window）时不因此被挡下', () => {
    expect(shouldHandleKey(press({ key: 'a' }), null)).toBe(true)
    expect(shouldHandleKey(press({ key: 'a' }), undefined)).toBe(true)
  })
})

describe('普通按键', () => {
  it('焦点在页面上时正常响应', () => {
    for (const key of ['a', 'r', 'j', 'k', '+', '-']) {
      expect(shouldHandleKey(press({ key }), BODY)).toBe(true)
    }
  })
})
