import { request } from '@/api/client'
import type { JsonBody, JsonOk } from '@/api/contract'

/**
 * §8.5 异常处理与排行榜维护。
 *
 * 这一组接口有两条共同前提，写在这里以免每个调用点各记一遍：
 *
 *   1. **全部要求新鲜令牌。** 服务端的这五个操作挂了 requireFreshAuth，
 *      令牌签发超过 5 分钟会返回 REAUTH_REQUIRED。api/client.ts 已经
 *      处理成「静默刷新后再放行」—— 但刷新是有配额的（最多两次重放），
 *      所以管理端的对话框不要在用户填原因的几十秒里反复提交。
 *
 *   2. **reason 必填且有长度下限。** 服务端在 schema 层就强制了，
 *      不存在「没有原因的异常操作」。界面上不要提供跳过原因的路径。
 */

type ReopenBody = JsonBody<'/api/v1/admin/checkins/{entryId}/reopen', 'post'>
type RevokeBody = JsonBody<'/api/v1/admin/checkins/{entryId}/revoke', 'post'>
type VoidBody = JsonBody<'/api/v1/admin/checkins/{entryId}/void', 'post'>
type ManualBody = JsonBody<'/api/v1/admin/checkins/manual', 'post'>
type AdjustmentBody = JsonBody<'/api/v1/admin/score-adjustments', 'post'>
type RebuildBody = JsonBody<'/api/v1/admin/leaderboards/rebuild', 'post'>
type FreezeBody = JsonBody<'/api/v1/admin/leaderboards/freeze', 'post'>
type UnfreezeBody = JsonBody<'/api/v1/admin/leaderboards/unfreeze', 'post'>

type ReopenResult = JsonOk<'/api/v1/admin/checkins/{entryId}/reopen', 'post'>
type RevokeResult = JsonOk<'/api/v1/admin/checkins/{entryId}/revoke', 'post'>
type VoidResult = JsonOk<'/api/v1/admin/checkins/{entryId}/void', 'post'>
type ManualResult = JsonOk<'/api/v1/admin/checkins/manual', 'post'>
type AdjustmentResult = JsonOk<'/api/v1/admin/score-adjustments', 'post'>
type RebuildResult = JsonOk<'/api/v1/admin/leaderboards/rebuild', 'post'>
type FreezeResult = JsonOk<'/api/v1/admin/leaderboards/freeze', 'post'>
type UnfreezeResult = JsonOk<'/api/v1/admin/leaderboards/unfreeze', 'post'>

/**
 * 临时重新开放某个打卡槽位。
 *
 * 返回的不只是记录状态，还有 `campaign_submittable` ——
 * 「重开成功」不等于「参赛者现在就能交」，活动本身不在可提交状态时
 * 会带回一句 warning，界面必须显示它，否则管理员会以为重开没生效。
 */
export function reopenEntry(entryId: string, body: ReopenBody): Promise<ReopenResult> {
  return request<ReopenResult>(`/admin/checkins/${encodeURIComponent(entryId)}/reopen`, {
    method: 'POST',
    body,
  })
}

/** 撤销审核结果。只对已通过的记录有效，其他状态返回 409 */
export function revokeEntry(entryId: string, body: RevokeBody): Promise<RevokeResult> {
  return request<RevokeResult>(`/admin/checkins/${encodeURIComponent(entryId)}/revoke`, {
    method: 'POST',
    body,
  })
}

/** 作废记录。任意状态均可，不可恢复 */
export function voidEntry(entryId: string, body: VoidBody): Promise<VoidResult> {
  return request<VoidResult>(`/admin/checkins/${encodeURIComponent(entryId)}/void`, {
    method: 'POST',
    body,
  })
}

/** 管理员补录。该槽位已有记录时返回 409 */
export function createManualEntry(body: ManualBody): Promise<ManualResult> {
  return request<ManualResult>('/admin/checkins/manual', { method: 'POST', body })
}

/**
 * §9.1 积分调整。
 *
 * 只新增一条调整记录，不改原始积分字段 —— 因此它**不检查赛道积分上限**，
 * 也**不会自动刷新已发布的排行榜**。界面上要把后半句说出来。
 */
export function createScoreAdjustment(body: AdjustmentBody): Promise<AdjustmentResult> {
  return request<AdjustmentResult>('/admin/score-adjustments', { method: 'POST', body })
}

/**
 * 重算排行榜（§14 的管理员触发项）。
 *
 * 不传 `cutoff_date` 时服务端算到「此刻应有的最新一天」（已有更新的快照时不倒退）；
 * 刻意不是「最近一份快照」—— 快照落后时那样点多少次都不会往前推进。
 * 榜单已冻结时返回 SNAPSHOT_FINALIZED —— 这个错误必须原样展示，
 * 它对应一个明确的操作（先解冻），吞掉它只会让管理员反复点重算。
 */
export function rebuildLeaderboard(body: RebuildBody): Promise<RebuildResult> {
  return request<RebuildResult>('/admin/leaderboards/rebuild', { method: 'POST', body })
}

/** 冻结最终榜单。冻结后重算会被拒绝，导出与展示都以这一份为准 */
export function freezeLeaderboard(body: FreezeBody): Promise<FreezeResult> {
  return request<FreezeResult>('/admin/leaderboards/freeze', { method: 'POST', body })
}

/** 解冻。必须指定 cutoff_date —— 解冻哪一份不能靠猜 */
export function unfreezeLeaderboard(body: UnfreezeBody): Promise<UnfreezeResult> {
  return request<UnfreezeResult>('/admin/leaderboards/unfreeze', { method: 'POST', body })
}
