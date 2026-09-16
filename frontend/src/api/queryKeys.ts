/**
 * TanStack Query 的 key 工厂。
 *
 * 全站只在这里拼 key，组件里不写裸字符串数组 ——
 * 否则「失效 today」这种操作会因为拼错一个词而静默失效，
 * 表现为界面数据不刷新，而没有任何报错。
 */
/**
 * 列表类查询的前缀。
 *
 * 名单、队列、审计、任务历史的 key 里都带着筛选条件
 * （`['admin','reviews','queue', {track:'reading'}]`），
 * 而失效时要打掉的是**这一类**查询的所有分桶，不是一个筛选条件。
 * 因此前缀单独提出来给 invalidationMap 用，而不是在那边手写一遍字面量。
 */
const ADMIN_QUEUE_PREFIX = ['admin', 'reviews', 'queue'] as const
const ADMIN_AUDIT_PREFIX = ['admin', 'audit'] as const
const ADMIN_JOB_RUNS_PREFIX = ['admin', 'jobs', 'runs'] as const
const ADMIN_PARTICIPANTS_PREFIX = ['admin', 'participants'] as const

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

  // ---- 管理后台 ----
  /**
   * 后台的 key 统一挂在 'admin' 下。
   *
   * 这不只是命名习惯：参赛者端与管理端的缓存必须能被一次性分开清理，
   * 而 `['admin', ...]` 这个前缀让「退出登录时全清」和「切到参赛者视图时
   * 只作废管理端」都能用一个前缀匹配做完（见 invalidationMap.adminAll）。
   */
  admin: {
    /** 后台首页统计（含调度计划与最近任务） */
    dashboard: ['admin', 'dashboard'] as const,
    /** 审核队列，按筛选条件区分 */
    reviewQueue: (filters: Record<string, unknown>) => [...ADMIN_QUEUE_PREFIX, filters] as const,
    /** 单条审核详情 */
    reviewDetail: (entryId: string) => ['admin', 'reviews', 'detail', entryId] as const,
    /** 预设驳回原因，全站一份 */
    rejectReasons: ['admin', 'reviews', 'reject-reasons'] as const,
    /** 管理端活动配置与赛道规则 */
    campaign: ['admin', 'campaign'] as const,
    /** 名单，管理端各处的参赛者搜索共用 */
    participants: (filters: Record<string, unknown>) => [...ADMIN_PARTICIPANTS_PREFIX, filters] as const,
    /** 审计日志，按筛选条件区分 */
    auditLogs: (filters: Record<string, unknown>) => [...ADMIN_AUDIT_PREFIX, filters] as const,
    /** 任务执行历史 */
    jobRuns: (filters: Record<string, unknown>) => [...ADMIN_JOB_RUNS_PREFIX, filters] as const,
  },
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

  // ---- 管理后台 ----
  /**
   * 审核一条记录之后。
   *
   * 不失效 `reviewDetail` —— 那是当前光标指向的那一条，页面自己会用
   * `setQueryData` 把新版本写回去。整体失效会让正在看的材料闪一下白，
   * 而审核是每秒都在切换的高频操作。
   */
  reviewDecide: [ADMIN_QUEUE_PREFIX, qk.admin.dashboard, ADMIN_AUDIT_PREFIX],

  /**
   * §8.5 的异常操作（补录、重开、撤销、作废）。
   *
   * 这四件事都可能把记录重新推回待审核队列（撤销与重开尤其如此），
   * 所以队列必须失效；它们也都会改变首页的计数。
   */
  adminOps: [ADMIN_QUEUE_PREFIX, qk.admin.dashboard, ADMIN_AUDIT_PREFIX],

  /**
   * 积分调整与排行榜维护。
   *
   * 刻意**不失效**榜单本身：§9 的说明是「已发布的排行榜不会自动更新，
   * 需要重新计算」，界面照实反映这一点比悄悄刷新更诚实 ——
   * 否则管理员会以为调整立刻生效了。
   */
  scoreAdjustment: [ADMIN_AUDIT_PREFIX],

  /** 重算 / 冻结 / 解冻之后：只有首页的榜单状态变了 */
  leaderboardMaintenance: [qk.admin.dashboard, ADMIN_AUDIT_PREFIX],

  /** 手动触发任务之后：首页的任务面板与历史都变了 */
  triggerJob: [qk.admin.dashboard, ADMIN_JOB_RUNS_PREFIX],

  /** 改活动或赛道规则：两份配置都要失效 */
  campaignConfig: [qk.admin.campaign, qk.admin.dashboard],
} as const

/** 整个管理端缓存前缀。退出登录或切到参赛者视图时用它一次性作废 */
export const ADMIN_PREFIX = ['admin'] as const
