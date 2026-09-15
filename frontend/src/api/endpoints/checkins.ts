import { request } from '../client'
import type { JsonOk, QueryOf } from '../contract'

type TodayResult = JsonOk<'/api/v1/checkins/today', 'get'>
type ListQuery = QueryOf<'/api/v1/checkins', 'get'>
type ListResult = JsonOk<'/api/v1/checkins', 'get'>
type DetailResult = JsonOk<'/api/v1/checkins/{entryId}', 'get'>
type SignedAssetResult = JsonOk<'/api/v1/checkins/{entryId}/assets/{assetId}', 'get'>

/**
 * 今日三赛道卡片（design.md §7.3）。
 *
 * 返回的 `can_submit` 已经综合考虑了时间窗、记录状态与**活动状态** ——
 * 后端保证它真实反映「此刻提交会不会被接受」，前端不必自己再拼一遍条件。
 */
export function fetchToday(): Promise<TodayResult> {
  return request<TodayResult>('/checkins/today')
}

export function fetchCheckins(query: ListQuery): Promise<ListResult> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const suffix = search.toString()
  return request<ListResult>(`/checkins${suffix ? `?${suffix}` : ''}`)
}

export function fetchCheckinDetail(entryId: string): Promise<DetailResult> {
  return request<DetailResult>(`/checkins/${encodeURIComponent(entryId)}`)
}

/**
 * 申请证明材料的短期签名地址（design.md §13）。
 *
 * 签名是**每个素材一次**调用，所以列表页不要逐行调用 ——
 * 50 行就是 150 次请求。只有详情页与提交页才签发。
 */
export function fetchSignedAssetUrl(entryId: string, assetId: string): Promise<SignedAssetResult> {
  return request<SignedAssetResult>(
    `/checkins/${encodeURIComponent(entryId)}/assets/${encodeURIComponent(assetId)}`,
  )
}
