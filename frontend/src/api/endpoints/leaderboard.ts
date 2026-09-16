import { request } from '../client'
import type { JsonOk, QueryOf } from '../contract'

type LatestQuery = QueryOf<'/api/v1/leaderboards/latest', 'get'>
type LatestResult = JsonOk<'/api/v1/leaderboards/latest', 'get'>
type MyRankQuery = QueryOf<'/api/v1/leaderboards/me', 'get'>
type MyRankResult = JsonOk<'/api/v1/leaderboards/me', 'get'>

/**
 * 最新排行榜快照。
 *
 * `track` 省略即总榜 —— 后端用固定哨兵值 __overall__ 表示总榜行，
 * 但查询时直接不传参数更清楚。
 */
export function fetchLeaderboard(query: LatestQuery): Promise<LatestResult> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const suffix = search.toString()
  return request<LatestResult>(`/leaderboards/latest${suffix ? `?${suffix}` : ''}`)
}

/** 我的排名与附近名次（榜单很长时用来定位自己） */
export function fetchMyRank(query: MyRankQuery): Promise<MyRankResult> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const suffix = search.toString()
  return request<MyRankResult>(`/leaderboards/me${suffix ? `?${suffix}` : ''}`)
}
