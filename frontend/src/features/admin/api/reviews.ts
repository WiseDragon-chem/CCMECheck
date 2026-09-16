import { request } from '@/api/client'
import type { JsonBody, JsonOk, QueryOf } from '@/api/contract'
import type { RejectReason, ReviewResult } from '@/api/types'
import { withQuery } from './query'

type QueueQuery = QueryOf<'/api/v1/admin/reviews/queue', 'get'>
type QueueResult = JsonOk<'/api/v1/admin/reviews/queue', 'get'>
type DetailResult = JsonOk<'/api/v1/admin/reviews/{entryId}', 'get'>
type ApproveBody = JsonBody<'/api/v1/admin/reviews/{entryId}/approve', 'post'>
type RejectBody = JsonBody<'/api/v1/admin/reviews/{entryId}/reject', 'post'>
type RejectReasonsResult = JsonOk<'/api/v1/admin/reviews/reject-reasons', 'get'>

/**
 * 待审核队列（design.md §8.2 左栏）。
 *
 * 响应里带 `progress`，且那份进度**不随筛选条件变化** ——
 * 它衡量的是「还剩多少活没干」。筛选只影响 entries，
 * 界面必须照此呈现，否则筛到某个赛道时会让人以为活干完了。
 */
export function fetchReviewQueue(query: QueueQuery): Promise<QueueResult> {
  return request<QueueResult>(withQuery('/admin/reviews/queue', query))
}

/** 审核详情：右栏与中栏所需的全部内容，一次取回 */
export function fetchReviewDetail(entryId: string): Promise<DetailResult> {
  return request<DetailResult>(`/admin/reviews/${encodeURIComponent(entryId)}`)
}

/**
 * 审核通过。
 *
 * `version` 必须回传审核员**看到的那一版**（由 reviewSession 冻结），
 * 不是当前最新版。传错会让服务端把并发冲突当成正常请求处理，
 * 或者反过来把正常的请求判成冲突。
 */
export function approveReview(entryId: string, body: ApproveBody): Promise<ReviewResult> {
  return request<ReviewResult>(`/admin/reviews/${encodeURIComponent(entryId)}/approve`, {
    method: 'POST',
    body,
  })
}

/** 审核驳回。`reason_code` 为 other 时 `reason` 必填，否则服务端返回 400 */
export function rejectReview(entryId: string, body: RejectBody): Promise<ReviewResult> {
  return request<ReviewResult>(`/admin/reviews/${encodeURIComponent(entryId)}/reject`, {
    method: 'POST',
    body,
  })
}

/**
 * 预设驳回原因。
 *
 * 文案由服务端给出而不是前端写死：原因码与原因文案是一对，
 * 分开放会让「服务端新增一个原因码」变成前端的一次静默失败。
 * 一次会话内不变，调用方用 staleTime: Infinity 缓存。
 */
export async function fetchRejectReasons(): Promise<RejectReason[]> {
  const result: RejectReasonsResult = await request<RejectReasonsResult>(
    '/admin/reviews/reject-reasons',
  )
  return result.reasons
}
