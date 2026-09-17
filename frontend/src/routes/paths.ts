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

  // ---- 管理后台（§8）----
  admin: {
    dashboard: '/admin',
    review: '/admin/review',
    reviewEntry: (entryId: string) => `/admin/review/${entryId}`,
    participants: '/admin/participants',
    ops: '/admin/ops',
    audit: '/admin/audit',
  },
} as const

/**
 * 找出当前路径对应的导航项。
 *
 * 必须取**最长**匹配。`/admin` 是一切后台路径的前缀，用 `find` 取第一个
 * 会把「概览」永远点亮 —— 点「审核」也是它亮，而界面上没有任何异常迹象，
 * 只是高亮停在一个不相干的入口上。这类问题不会报错，只会让人以为点错了。
 *
 * 匹配 `key` 本身或 `key/` 开头，于是：
 *   * `/admin/review/abc123`（审核页的深链）落到「审核」上；
 *   * `/adminxxx` 这种仅仅字符串前缀相同的路径不会误匹配。
 */
export function matchNavKey(pathname: string, keys: readonly string[]): string | undefined {
  return keys
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
}
