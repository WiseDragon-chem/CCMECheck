/**
 * 拼查询串。
 *
 * 管理端有七个列表接口（审核队列、名单、审计、任务历史…）都要拼查询串，
 * 逐个文件重写一遍 URLSearchParams 迟早会出现某处漏了空值过滤 ——
 * 于是 `?track=` 被当成「筛选一个空赛道」发出去，返回 0 条且不报错。
 *
 * 规则：undefined / null / 空串一律不发。这是刻意的 ——
 * 空筛选条件在界面上等于「不筛选」，不该变成「筛选空值」。
 */
export function withQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }

  const suffix = search.toString()
  return suffix ? `${path}?${suffix}` : path
}
