/**
 * TanStack Query 的 key 工厂。
 *
 * 全站只在这里拼 key，组件里不写裸字符串数组 ——
 * 否则「失效 today」这种操作会因为拼错一个词而静默失效，
 * 表现为界面数据不刷新，而没有任何报错。
 *
 * 管理端的 key 随下一阶段的后台一起加。
 */
export const qk = {
  /** 当前用户 */
  me: ['me'] as const,
  /** 当前活动与赛道规则（一次会话内基本不变） */
  campaign: ['campaign', 'current'] as const,
  /** 今日三赛道卡片 */
  today: ['checkins', 'today'] as const,
  /** 个人打卡记录列表，按筛选条件区分 */
  checkinList: (filters: Record<string, unknown>) => ['checkins', 'list', filters] as const,
  /** 单条打卡详情 */
  checkinDetail: (entryId: string) => ['checkins', 'detail', entryId] as const,
  /** 签名图片地址，按 (entry, asset) 缓存 */
  signedAsset: (entryId: string, assetId: string) => ['assets', 'signed', entryId, assetId] as const,
  /** 排行榜快照，track 省略即总榜 */
  leaderboard: (track?: string) => ['leaderboard', 'latest', track ?? '__overall__'] as const,
  /** 我的排名与附近名次 */
  myRank: (track: string | undefined, neighbors: number) =>
    ['leaderboard', 'me', track ?? '__overall__', neighbors] as const,
} as const

/**
 * 各写操作应当失效哪些查询。
 *
 * 写成一张表而不是散落在各个 mutation 回调里，是为了能一眼看全
 * 「改了这个会影响哪些界面」，也避免漏失效。
 *
 * 有两处**刻意不失效**，它们看起来像 bug，其实不是：
 *
 *   1. 提交打卡不失效排行榜。榜单是每日快照（design.md §9.2），
 *      今天通过的记录本就不会改变它，刷新只会得到一个误导性的 loading。
 *
 *   2. 修改密码不失效 me 以外的任何东西 —— 令牌由拦截器换掉了，
 *      服务端状态没有变化。
 */
export const invalidationMap = {
  submitCheckin: [qk.today, ['checkins', 'list']],
  changePassword: [qk.me],
} as const
