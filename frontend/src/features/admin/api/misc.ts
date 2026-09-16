import { request } from '@/api/client'
import type { JsonOk, QueryOf } from '@/api/contract'
import { withQuery } from './query'

/**
 * 概览、名单、活动配置、审计、任务。
 *
 * 合在一个文件里而不是各自成篇：它们的共同点是**只读**，
 * 加起来也没有审核与异常处理那两组复杂。写操作单独成篇，
 * 是为了让「哪些接口会改数据」在目录里一眼可辨。
 */

// ---------------------------------------------------------------------------
// 概览（§8.1）
// ---------------------------------------------------------------------------

type DashboardResult = JsonOk<'/api/v1/admin/dashboard', 'get'>

/**
 * 首页的全部数字。
 *
 * 一次请求给全，是因为拆成多个接口只会让几个卡片先后跳数；
 * 管理员打开首页就是要在一屏里看全。`scheduled_jobs` 也在这个响应里，
 * 它是调度器的内存状态，不来自数据库 —— 因此首页刷新一次就能核对
 * 「某个时间点为什么没跑」。
 */
export function fetchDashboard(): Promise<DashboardResult> {
  return request<DashboardResult>('/admin/dashboard')
}

// ---------------------------------------------------------------------------
// 名单（§8.3 的读取部分，异常处理页搜索参赛者用）
// ---------------------------------------------------------------------------

type ParticipantsQuery = QueryOf<'/api/v1/admin/participants', 'get'>
type ParticipantsResult = JsonOk<'/api/v1/admin/participants', 'get'>

/** 名单分页查询。按学号升序，便于与纸质名单核对 */
export function fetchParticipants(query: ParticipantsQuery): Promise<ParticipantsResult> {
  return request<ParticipantsResult>(withQuery('/admin/participants', query))
}

// ---------------------------------------------------------------------------
// 活动配置（§8.4 的读取部分，异常处理页要赛道列表）
// ---------------------------------------------------------------------------

type CampaignConfigResult = JsonOk<'/api/v1/admin/campaign', 'get'>

/**
 * 管理端的活动配置。
 *
 * 刻意不复用参赛者侧的 `/campaigns/current` —— 那个带 server_time、
 * activity_date 等只对打卡倒计时有意义的字段，管理端不返回它们。
 * 用错接口的结果是页面上读到一批永远 undefined 的字段。
 */
export function fetchCampaignConfig(): Promise<CampaignConfigResult> {
  return request<CampaignConfigResult>('/admin/campaign')
}

// ---------------------------------------------------------------------------
// 审计日志（§12.4）
// ---------------------------------------------------------------------------

type AuditQuery = QueryOf<'/api/v1/admin/audit-logs', 'get'>
type AuditResult = JsonOk<'/api/v1/admin/audit-logs', 'get'>

/**
 * 审计日志查询。
 *
 * 审计表只追加，这个模块**只有读接口** —— 没有写入、没有删除，
 * 界面也不该提供任何看起来能改它的入口。
 */
export function fetchAuditLogs(query: AuditQuery): Promise<AuditResult> {
  return request<AuditResult>(withQuery('/admin/audit-logs', query))
}

// ---------------------------------------------------------------------------
// 定时任务（§14）
// ---------------------------------------------------------------------------

type JobRunsQuery = QueryOf<'/api/v1/admin/jobs/runs', 'get'>
type JobRunsResult = JsonOk<'/api/v1/admin/jobs/runs', 'get'>
type TriggerResult = JsonOk<'/api/v1/admin/jobs/{name}/run', 'post'>

/** 任务名。契约里是 JobName 枚举，不接受任意字符串 —— 拼错了应当是编译错误 */
export type ScheduledJobName = TriggerResult['job_name']

/** 任务执行历史 */
export function fetchJobRuns(query: JobRunsQuery): Promise<JobRunsResult> {
  return request<JobRunsResult>(withQuery('/admin/jobs/runs', query))
}

/**
 * 手动触发一个任务。
 *
 * 任务失败也返回 200 —— 失败信息就是这次的执行结果（`error` 里带原因）。
 * 所以调用方**不能**靠 catch 判断成败，必须看返回的 `status`：
 * 把 5xx 留给「请求根本没发出去」，这两种情况对管理员的意义完全不同。
 */
export function triggerJob(name: ScheduledJobName): Promise<TriggerResult> {
  return request<TriggerResult>(`/admin/jobs/${encodeURIComponent(name)}/run`, { method: 'POST' })
}
