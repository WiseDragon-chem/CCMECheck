/**
 * 审核会话的状态机（design.md §8.2）。
 *
 * 抽成纯函数而不是散在组件里，是因为这里有几条不显眼但很要命的规则：
 * 光标跨越已决项、队列末端的边界、以及**版本号在聚焦期间必须冻结**。
 * 它们在浏览器里都很难稳定复现，但用纯函数测起来是一行的事。
 */

export interface QueueLike {
  entry_id: string
}

export interface ReviewSession {
  /**
   * 本次会话中已经处理过的记录。
   *
   * 这是「键盘流是否顺畅」的分水岭：审完一条不重新拉队列，
   * 而是把它记在这里，可见队列 = 服务端队列减去已决项。
   * 每审一条就重取会让光标跳动、界面闪烁，键盘流就断在这里。
   */
  decided: readonly string[]
  cursorId: string | null
  /**
   * 光标落到某条时冻结的版本号。
   *
   * 提交审核时读它，而不是读详情里的 `version` —— 背景刷新
   * （窗口重新聚焦时的自动重取）会悄悄改掉详情里的版本号，
   * 于是出现「看着第 2 版、提交的却是第 1 版的版本号」，
   * 而服务端会认为这是并发冲突，把审核员的结论丢掉。
   */
  versionAtFocus: number | null
}

export function initialSession(entries: readonly QueueLike[], cursorId?: string | null): ReviewSession {
  const requested = cursorId && entries.some((entry) => entry.entry_id === cursorId) ? cursorId : null
  return {
    decided: [],
    cursorId: requested ?? entries[0]?.entry_id ?? null,
    versionAtFocus: null,
  }
}

/** 可见队列 = 服务端队列减去本次会话已决的那些 */
export function visibleEntries<T extends QueueLike>(
  entries: readonly T[],
  decided: readonly string[],
): T[] {
  if (decided.length === 0) return [...entries]
  const decidedSet = new Set(decided)
  return entries.filter((entry) => !decidedSet.has(entry.entry_id))
}

/**
 * 记录一条决策，并把光标推到下一条。
 *
 * 推进依据是**决策前**的可见列表 —— 决策后当前项就从列表里消失了，
 * 拿新列表去找「下一条」只会从头开始。
 * 当前项本来就是最后一条时后退一格，而不是把光标清空 ——
 * 审完最后一条的人应该停在上一条上，而不是面对一个空面板。
 */
export function decideAndAdvance(
  session: ReviewSession,
  entryId: string,
  visibleBeforeDecide: readonly string[],
): ReviewSession {
  const decided = session.decided.includes(entryId) ? session.decided : [...session.decided, entryId]

  const index = visibleBeforeDecide.indexOf(entryId)
  // 不在可见列表里（并发刷新后被移走）时不乱动光标
  if (index === -1) {
    return { ...session, decided }
  }

  const remaining = visibleBeforeDecide.filter((id) => id !== entryId)
  const nextId = remaining[index] ?? remaining[index - 1] ?? null

  return { decided, cursorId: nextId, versionAtFocus: null }
}

/** 上下移动光标，两端不越界 */
export function moveCursor(
  session: ReviewSession,
  visible: readonly string[],
  delta: number,
): ReviewSession {
  if (visible.length === 0) return { ...session, cursorId: null, versionAtFocus: null }

  const index = session.cursorId ? visible.indexOf(session.cursorId) : -1
  // 当前项不在可见列表里时从头开始，而不是停在一个看不见的游标上
  if (index === -1) {
    const first = visible[0] ?? null
    return first === session.cursorId ? session : { ...session, cursorId: first, versionAtFocus: null }
  }

  const next = Math.min(visible.length - 1, Math.max(0, index + delta))
  if (next === index) return session

  return { ...session, cursorId: visible[next] ?? null, versionAtFocus: null }
}

/** 光标落到某条时冻结它的版本号 */
export function focusEntry(session: ReviewSession, entryId: string, version: number | null): ReviewSession {
  // 已经在同一条上就不动 —— 否则背景刷新会顺带把冻结的版本号解冻
  if (session.cursorId === entryId && session.versionAtFocus !== null) return session
  return { ...session, cursorId: entryId, versionAtFocus: version }
}

/**
 * 用户**显式**刷新后，把冻结的版本号更新到最新的。
 *
 * 只有这个入口能改 `versionAtFocus`。背景重取不算 ——
 * 那正是「看着第 2 版、提交第 1 版」的来源。
 */
export function acceptRefreshedVersion(session: ReviewSession, version: number): ReviewSession {
  return { ...session, versionAtFocus: version }
}

/** 光标指向的记录，其详情版本已经和冻结的不一致了 —— 需要提示审核员 */
export function isDetailStale(session: ReviewSession, detailVersion: number | null): boolean {
  if (session.versionAtFocus === null || detailVersion === null) return false
  return session.versionAtFocus !== detailVersion
}

/**
 * 光标越过了已加载页的末尾时，还该不该继续取下一页。
 *
 * 服务端的已决记录仍然占着页码，所以不能简单地按可见长度判断，
 * 要一直取到出现未决项或者翻过了 total。
 */
export function shouldFetchMore(params: {
  cursorId: string | null
  loadedIds: readonly string[]
  loadedCount: number
  total: number
}): boolean {
  const { cursorId, loadedIds, loadedCount, total } = params
  if (loadedCount >= total) return false
  if (loadedIds.length === 0) return false
  // 光标已经落在已加载范围的最后几条里，提前取下一页
  if (!cursorId) return true
  const index = loadedIds.indexOf(cursorId)
  if (index === -1) return true
  return index >= loadedIds.length - 3
}
