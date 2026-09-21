import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasSeen, markSeen, requestReplay, resetReplayRequestsForTest } from './guideIds'
import { useGuide } from './useGuide'

/** 重播请求是模块级变量，用例之间必须清掉，否则会互相干扰 */
afterEach(() => {
  resetReplayRequestsForTest()
  vi.restoreAllMocks()
})

describe('useGuide', () => {
  it('ready 为 false 时不开启 —— 内容还没出来就别对着骨架屏讲话', () => {
    const { result } = renderHook(() => useGuide('home', { ready: false }))
    expect(result.current.open).toBe(false)
  })

  it('ready 退回 false 时先让位，再就绪时回来 —— 不算看过了', () => {
    /*
      内容没了（重取失败、切到空状态）就该把引导收起来，锚点已经不在了。
      但它没有被用户关过，所以下次就绪时应当重新出现，而不是被当成
      「已经演示过」。
    */
    const { result, rerender } = renderHook(({ ready }) => useGuide('home', { ready }), {
      initialProps: { ready: true },
    })
    expect(result.current.open).toBe(true)

    rerender({ ready: false })
    expect(result.current.open).toBe(false)
    expect(hasSeen('home')).toBe(false)

    rerender({ ready: true })
    expect(result.current.open).toBe(true)
  })

  it('ready 由 false 翻成 true 后开启', () => {
    const { result, rerender } = renderHook(({ ready }) => useGuide('home', { ready }), {
      initialProps: { ready: false },
    })
    expect(result.current.open).toBe(false)

    rerender({ ready: true })
    expect(result.current.open).toBe(true)
  })

  it('关闭之后再抖动 ready 不会重新弹出来', () => {
    // 页面数据会反复重取，ready 若被当成「每次 true 都判断一次」的开关，
    // 用户关掉引导十几秒后会被再弹一次 —— 这条用例就是钉住这一点。
    const { result, rerender } = renderHook(({ ready }) => useGuide('home', { ready }), {
      initialProps: { ready: true },
    })
    expect(result.current.open).toBe(true)

    act(() => result.current.onClose())
    expect(result.current.open).toBe(false)

    rerender({ ready: false })
    rerender({ ready: true })
    expect(result.current.open).toBe(false)
  })

  it('关闭时才写下「看过」，此时不再开启', () => {
    const { result } = renderHook(() => useGuide('home', { ready: true }))
    expect(hasSeen('home')).toBe(false)

    act(() => result.current.onClose())
    expect(hasSeen('home')).toBe(true)
    expect(result.current.open).toBe(false)
  })

  it('已经看过就不再开启 —— 每个浏览器只演示一遍', () => {
    markSeen('home')
    const { result } = renderHook(() => useGuide('home', { ready: true }))
    expect(result.current.open).toBe(false)
  })

  it('各页的标记互不影响', () => {
    markSeen('home')
    const { result } = renderHook(() => useGuide('leaderboard', { ready: true }))
    expect(result.current.open).toBe(true)
  })

  it('看过之后，重播请求仍能把它打开', () => {
    markSeen('leaderboard')
    requestReplay('leaderboard')

    const { result } = renderHook(() => useGuide('leaderboard', { ready: true }))
    expect(result.current.open).toBe(true)
  })

  it('重播打开之后页面重渲染，引导不会自己关掉', () => {
    /*
      主页面每秒因倒计时的 useTicker 重渲染一次。open 是渲染期推导的，
      而重播请求在打开的瞬间就被 consume 掉了 —— 若不把「兑现过」记成
      状态，下一次重渲染会看到「既没有重播请求、又早已看过」，把引导关掉。
      表现为：在「我的」点「打卡流程说明」，跳到首页后气泡出现不到 1 秒
      就消失（排行榜没有 ticker，所以那边不复现）。
    */
    markSeen('home')
    requestReplay('home')

    const { result, rerender } = renderHook(({ ready }) => useGuide('home', { ready }), {
      initialProps: { ready: true },
    })
    expect(result.current.open).toBe(true)

    // 就是 useTicker 那一拍
    rerender({ ready: true })
    expect(result.current.open).toBe(true)
  })

  it('重播请求只兑现一次', () => {
    markSeen('leaderboard')
    requestReplay('leaderboard')

    const first = renderHook(() => useGuide('leaderboard', { ready: true }))
    expect(first.result.current.open).toBe(true)
    act(() => first.result.current.onClose())
    first.unmount()

    const second = renderHook(() => useGuide('leaderboard', { ready: true }))
    expect(second.result.current.open).toBe(false)
  })

  it('重播请求认 id，不会串到别的页面', () => {
    markSeen('home')
    markSeen('leaderboard')
    requestReplay('home')

    const { result } = renderHook(() => useGuide('leaderboard', { ready: true }))
    expect(result.current.open).toBe(false)

    // 没被取走，目标页面仍然拿得到
    const home = renderHook(() => useGuide('home', { ready: true }))
    expect(home.result.current.open).toBe(true)
  })

  it('重播时从第一步开始，不沿用上次的进度', () => {
    requestReplay('home')
    const { result } = renderHook(() => useGuide('home', { ready: true }))

    act(() => result.current.onChange(2))
    expect(result.current.current).toBe(2)

    act(() => result.current.onClose())
    expect(result.current.current).toBe(0)
  })

  it('localStorage 不可写时不抛异常', () => {
    // 隐私模式、禁用 Cookie 的环境下 localStorage 会直接抛
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const { result } = renderHook(() => useGuide('home', { ready: true }))
    expect(result.current.open).toBe(true)
    expect(() => act(() => result.current.onClose())).not.toThrow()
  })

  it('localStorage 不可读时当作已看过，不每次刷新都弹', () => {
    // 读失败时宁可漏掉一次可选引导，也好过每次刷新都弹一个关不掉的窗
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    const { result } = renderHook(() => useGuide('home', { ready: true }))
    expect(result.current.open).toBe(false)
  })
})
