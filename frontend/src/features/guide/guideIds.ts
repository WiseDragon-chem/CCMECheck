/**
 * 操作指导的 id、持久化与重播登记。
 *
 * 「引导在哪些页面出现」和「这个浏览器看过没有」这两件事都收在这里，
 * 页面只负责传一个 id 和一组步骤。
 */

/**
 * 全部引导。类型由它推出来，别再单独写一份联合类型 ——
 * 两处维护的话，新增一段引导时很容易漏掉下面 markAllSeenForTest 那一份。
 */
export const GUIDE_IDS = ['login', 'activate', 'home', 'leaderboard'] as const

export type GuideId = (typeof GUIDE_IDS)[number]

/**
 * 文案改版后 bump 一下，所有引导会重新演示一遍。
 *
 * 「每个浏览器只演示一遍」是需求，但把标记写成不带版本的固定键，
 * 后续修订就永远触达不了老用户 —— 讲错了也收不回来。
 * 版本号是这两者之间的折中：不动它就真的只演示一遍。
 */
const VERSION = 1

const keyOf = (id: GuideId) => `ccme:tour:v${VERSION}:${id}`

/**
 * 这个浏览器看过某段引导没有。
 *
 * 存 localStorage 而不是 sessionStorage：需求是每个**浏览器**一遍，
 * 关掉标签页再回来不该重演。
 *
 * 读失败时返回 true（当作看过）。隐私模式或禁用 Cookie 的环境下
 * localStorage 会直接抛异常，此时「漏掉一次可选引导」远好过
 * 「每次刷新都弹一个关不掉的窗」。
 *
 * 这里存的只是一个布尔值。`src/api/tokenStore.ts` 那条「令牌不进
 * localStorage」的规矩不能因为这里开了先例就放宽 —— 别把任何凭证类
 * 的东西写进这个模块。
 */
export function hasSeen(id: GuideId): boolean {
  try {
    return window.localStorage.getItem(keyOf(id)) !== null
  } catch {
    return true
  }
}

export function markSeen(id: GuideId): void {
  try {
    window.localStorage.setItem(keyOf(id), '1')
  } catch {
    // 记不住就记不住，下次再演示一遍，不影响任何功能
  }
}

/**
 * 重播请求。
 *
 * 「我的」页的入口要先跳到目标页面、再由那个页面播放引导，跨了组件，
 * 于是用这个模块级变量交接。
 *
 * **只放内存，不持久化**：它表示的是一次点击的意图，刷新之后就该消失。
 */
let pendingReplay: GuideId | null = null

export function requestReplay(id: GuideId): void {
  pendingReplay = id
}

/**
 * 只读地看一眼有没有待兑现的请求。
 *
 * 与 consumeReplayRequest 分开是因为使用时机不同：这个在**渲染期**读
 * （推导引导开不开），上面那个在 effect 里兑现。渲染期不能顺手清掉 ——
 * StrictMode 会把渲染跑两遍，第一遍清掉后第二遍就看不到请求了。
 */
export function isReplayRequested(id: GuideId): boolean {
  return pendingReplay === id
}

/**
 * 取走即清空 —— 一次请求只播放一次。
 *
 * 目标页面若一直没加载出来（网络错误、数据缺失），请求会留在原处，
 * 下次再进那个页面时补上。这比「过期作废」更符合用户的预期：
 * 他点的是「我要看这个说明」，不是「五秒内给我看」。
 */
export function consumeReplayRequest(id: GuideId): boolean {
  if (pendingReplay !== id) return false
  pendingReplay = null
  return true
}

/** 仅供测试：清掉内存里的重播请求，避免用例之间互相影响 */
export function resetReplayRequestsForTest(): void {
  pendingReplay = null
}

/**
 * 仅供测试：把所有引导标记成看过。
 *
 * 渲染主页面 / 排行榜的用例用它把引导关掉。不关的话那些用例会顺带把
 * 引导也渲染出来，而引导文案里含有「今日尚未打卡」这类与卡片状态
 * 一模一样的字样 —— 页面用例里的 getByText 会从「找到一个」变成
 * 「找到两个」，失败信息还指向一个和它无关的地方。
 */
export function markAllSeenForTest(): void {
  for (const id of GUIDE_IDS) {
    markSeen(id)
  }
}
