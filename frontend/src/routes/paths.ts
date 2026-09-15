/**
 * 全站路径常量。
 *
 * 散落的字符串字面量会在重命名路由时漏改，而漏改的表现是 404 而不是编译错误。
 */
export const paths = {
  login: '/login',
  activate: '/activate',

  home: '/home',
  submit: (track: string) => `/checkin/${track}`,
  records: '/records',
  recordDetail: (entryId: string) => `/records/${entryId}`,
  leaderboard: '/leaderboard',
  me: '/me',
} as const

/** 底部导航的四个入口 */
export const NAV_ITEMS = [
  { key: 'home', label: '首页', to: paths.home },
  { key: 'records', label: '记录', to: paths.records },
  { key: 'leaderboard', label: '排行榜', to: paths.leaderboard },
  { key: 'me', label: '我的', to: paths.me },
] as const
