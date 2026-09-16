import { describe, expect, it } from 'vitest'
import {
  acceptRefreshedVersion,
  decideAndAdvance,
  focusEntry,
  initialSession,
  isDetailStale,
  moveCursor,
  shouldFetchMore,
  visibleEntries,
  type ReviewSession,
} from './reviewSession'

/**
 * 审核会话的状态机（design.md §8.2）。
 *
 * 这些规则在浏览器里都很难稳定复现 —— 要按住 J 连点、要在恰好的时刻
 * 撞上背景刷新、要把队列审到最后一条。纯函数测起来是一行的事，
 * 而它们每一条都对应一次真实的数据事故，所以值得逐条钉住。
 */

const entry = (id: string) => ({ entry_id: id })
/** 三条一组的队列，绝大多数用例都用它 */
const THREE = [entry('a'), entry('b'), entry('c')]

describe('建立会话', () => {
  it('深链指定的那条在队列里时，从它开始', () => {
    expect(initialSession(THREE, 'b').cursorId).toBe('b')
  })

  it('深链指定的那条不在队列里时退回第一条，而不是留一个空光标', () => {
    // 别人已经审掉了这条，或者筛选条件把它排除了。
    // 停在一个看不见的游标上会让右栏一片空白，而队列明明还有活。
    expect(initialSession(THREE, 'ghost').cursorId).toBe('a')
  })

  it('空队列没有光标', () => {
    expect(initialSession([], 'a').cursorId).toBeNull()
  })

  it('新会话没有已决项，也没有冻结的版本号', () => {
    const session = initialSession(THREE)
    expect(session.decided).toEqual([])
    expect(session.versionAtFocus).toBeNull()
  })
})

describe('可见队列', () => {
  it('本次会话已决的记录不再出现', () => {
    expect(visibleEntries(THREE, ['b']).map((item) => item.entry_id)).toEqual(['a', 'c'])
  })

  it('没有已决项时原样返回', () => {
    expect(visibleEntries(THREE, []).map((item) => item.entry_id)).toEqual(['a', 'b', 'c'])
  })

  it('已决项里混进不在队列的 id 也不会误伤', () => {
    expect(visibleEntries(THREE, ['ghost']).map((item) => item.entry_id)).toEqual(['a', 'b', 'c'])
  })
})

describe('决定一条之后推进光标', () => {
  it('推进依据是决策前的列表 —— 决策后当前项就消失了', () => {
    const session = initialSession(THREE)
    const next = decideAndAdvance(session, 'a', ['a', 'b', 'c'])
    expect(next.decided).toEqual(['a'])
    expect(next.cursorId).toBe('b')
  })

  it('审的是队列末条时后退一格，而不是清空光标', () => {
    // 审完最后一条的人应该看到上一条，而不是一个空面板
    const session: ReviewSession = { decided: [], cursorId: 'c', versionAtFocus: 3 }
    const next = decideAndAdvance(session, 'c', ['a', 'b', 'c'])
    expect(next.cursorId).toBe('b')
    expect(next.decided).toEqual(['c'])
  })

  it('队列真的清空时得到一个空光标', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 1 }
    expect(decideAndAdvance(session, 'a', ['a']).cursorId).toBeNull()
  })

  it('离开这一条时必须解冻版本号', () => {
    // 不解冻的话，下一条会用上一条的版本号去提交，
    // 服务端判成并发冲突，审核员的结论被丢掉
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 7 }
    expect(decideAndAdvance(session, 'a', ['a', 'b']).versionAtFocus).toBeNull()
  })

  it('并发刷新把当前项移出列表时不乱动光标', () => {
    const session: ReviewSession = { decided: [], cursorId: 'b', versionAtFocus: null }
    const next = decideAndAdvance(session, 'ghost', ['a', 'b'])
    expect(next.cursorId).toBe('b')
    expect(next.decided).toEqual(['ghost'])
  })

  it('重复决定同一条不会在已决列表里留下两份', () => {
    const session: ReviewSession = { decided: ['a'], cursorId: 'b', versionAtFocus: null }
    expect(decideAndAdvance(session, 'a', ['b']).decided).toEqual(['a'])
  })
})

describe('移动光标', () => {
  it('两端不越界', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: null }
    expect(moveCursor(session, ['a', 'b'], -1).cursorId).toBe('a')

    const last: ReviewSession = { decided: [], cursorId: 'b', versionAtFocus: null }
    expect(moveCursor(last, ['a', 'b'], 1).cursorId).toBe('b')
  })

  it('原地不动时返回同一个对象，不触发无意义的重渲染', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: null }
    expect(moveCursor(session, ['a', 'b'], -1)).toBe(session)
  })

  it('光标不在可见列表里时从头开始', () => {
    const session: ReviewSession = { decided: [], cursorId: 'ghost', versionAtFocus: 5 }
    const next = moveCursor(session, ['a', 'b'], 1)
    expect(next.cursorId).toBe('a')
    expect(next.versionAtFocus).toBeNull()
  })

  it('空列表清空光标', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 1 }
    expect(moveCursor(session, [], 1).cursorId).toBeNull()
  })

  it('移动会解冻版本号', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 7 }
    expect(moveCursor(session, ['a', 'b'], 1).versionAtFocus).toBeNull()
  })
})

describe('版本号冻结', () => {
  it('光标落到某条时记下它的版本', () => {
    const session = initialSession(THREE)
    expect(focusEntry(session, 'a', 4).versionAtFocus).toBe(4)
  })

  it('背景刷新把版本推高时，冻结值不变', () => {
    // 这正是「看着第 2 版、提交第 1 版的版本号」的来源。
    // 已经在同一条上就不该被改写 —— 所以 focusEntry 要幂等。
    const focused: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 2 }
    expect(focusEntry(focused, 'a', 9).versionAtFocus).toBe(2)
  })

  it('版本号还没到手时保持未冻结，而不是冻成 null', () => {
    // 「还没加载完」和「已经冻结成 null」必须区分：前者要继续等，
    // 后者会让提交永远带着一个空版本号
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: null }
    const next = focusEntry(session, 'a', null)
    expect(next.versionAtFocus).toBeNull()
    expect(next.cursorId).toBe('a')
  })

  it('详情到达后能补上冻结值 —— 上一条的 null 不会把它锁死', () => {
    // 这正是上一条行为的意义：守卫只认「已经冻结过」，
    // 所以 null 状态可以随时被真正的版本号替换
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: null }
    expect(focusEntry(session, 'a', 6).versionAtFocus).toBe(6)
  })

  it('换一条记录会重新冻结', () => {
    const focused: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 2 }
    expect(focusEntry(focused, 'b', 5).versionAtFocus).toBe(5)
  })

  it('只有显式接受刷新后的版本才能改动冻结值', () => {
    const focused: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 2 }
    expect(acceptRefreshedVersion(focused, 9).versionAtFocus).toBe(9)
  })
})

describe('详情是否已经落后于冻结的版本', () => {
  it('两边都有值且不同才算落后', () => {
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 2 }
    expect(isDetailStale(session, 3)).toBe(true)
    expect(isDetailStale(session, 2)).toBe(false)
  })

  it('任一边没有值时不提示 —— 那只是还没加载完', () => {
    // 把「还没到」当成「有更新」会让审核员一打开页面就看到一条假警告
    const session: ReviewSession = { decided: [], cursorId: 'a', versionAtFocus: 2 }
    expect(isDetailStale(session, null)).toBe(false)
    expect(isDetailStale({ ...session, versionAtFocus: null }, 3)).toBe(false)
  })
})

describe('该不该接着取下一页', () => {
  const base = { loadedIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], loadedCount: 10, total: 40 }

  it('已经取到总数就不取了', () => {
    expect(shouldFetchMore({ ...base, cursorId: 'j', loadedCount: 40 })).toBe(false)
  })

  it('一条都还没加载时不取', () => {
    expect(shouldFetchMore({ ...base, cursorId: null, loadedIds: [], loadedCount: 0 })).toBe(false)
  })

  it('光标跑到还没加载的地方时接着取', () => {
    // 已决记录在服务端仍占着页码，所以光标可能落在已加载范围之外
    expect(shouldFetchMore({ ...base, cursorId: 'ghost' })).toBe(true)
  })

  it('光标接近已加载范围的末尾时提前取', () => {
    // 差三条以内就取，光标移到末尾时才不会停下来等一个网络往返
    expect(shouldFetchMore({ ...base, cursorId: 'h' })).toBe(true)
    expect(shouldFetchMore({ ...base, cursorId: 'g' })).toBe(false)
  })

  it('没有光标时取 —— 说明当前这批已经被审完了', () => {
    expect(shouldFetchMore({ ...base, cursorId: null })).toBe(true)
  })
})
