import { request } from '@/api/client'
import type { JsonBody, JsonOk, QueryOf } from '@/api/contract'
import { downloadCsv } from '@/lib/download'
import { withQuery } from './query'

/**
 * 名单管理（design.md §8.3）。
 *
 * 这个模块有两个接口是**只用一次**的：它们返回的明文（激活码、初始密码）
 * 在服务端只存哈希，响应过去之后再也拿不回来（§13）。界面上因此不能
 * 把它们塞进 toast 或者随手关掉的对话框 —— 见 ActivationCodeModal。
 */

type ListQuery = QueryOf<'/api/v1/admin/participants', 'get'>
type ListResult = JsonOk<'/api/v1/admin/participants', 'get'>

type CreateBody = JsonBody<'/api/v1/admin/participants', 'post'>
type CreateResult = JsonOk<'/api/v1/admin/participants', 'post'>

type StatusBody = JsonBody<'/api/v1/admin/participants/{participantId}', 'patch'>
type StatusResult = JsonOk<'/api/v1/admin/participants/{participantId}', 'patch'>

type ActivationResult = JsonOk<'/api/v1/admin/participants/{participantId}/activation-code', 'post'>
type ResetResult = JsonOk<'/api/v1/admin/participants/{participantId}/reset-password', 'post'>

type AnonymizeBody = JsonBody<'/api/v1/admin/participants/{participantId}/anonymize', 'post'>
type AnonymizeResult = JsonOk<'/api/v1/admin/participants/{participantId}/anonymize', 'post'>

type PreviewResult = JsonOk<'/api/v1/admin/participants/import/preview', 'post'>
type CommitBody = JsonBody<'/api/v1/admin/participants/import/commit', 'post'>
type CommitResult = JsonOk<'/api/v1/admin/participants/import/commit', 'post'>

/** 名单列表。按学号升序，便于与纸质名单核对 */
export function fetchParticipantsList(query: ListQuery): Promise<ListResult> {
  return request<ListResult>(withQuery('/admin/participants', query))
}

/**
 * 添加单个参赛者。
 *
 * 响应里带**一次性明文激活码**（库里只存哈希）。调用方必须把它交给
 * ActivationCodeModal 展示，而不是自己用个 message 弹一下。
 */
export function createParticipant(body: CreateBody): Promise<CreateResult> {
  return request<CreateResult>('/admin/participants', { method: 'POST', body })
}

/**
 * 启用 / 禁用。
 *
 * 只接受 active 与 disabled 两个值：anonymized 走单独的匿名化流程 ——
 * 一旦误设成 anonymized，姓名快照就再也回不来了（服务端 schema 的注释也是这么写的）。
 * 禁用会一并撤销该账号的登录会话，响应里的 revoked_sessions 就是那个数字。
 */
export function updateParticipantStatus(
  participantId: string,
  body: StatusBody,
): Promise<StatusResult> {
  return request<StatusResult>(`/admin/participants/${encodeURIComponent(participantId)}`, {
    method: 'PATCH',
    body,
  })
}

/**
 * 重新生成激活码。
 *
 * **会作废该账号此前所有未使用的码**（服务端是删除而不是标记已使用，
 * 否则 activation-codes.csv 的「已使用」列会说谎）。
 * 所以这个动作要有确认，不能是一个顺手点的图标。
 */
export function regenerateActivationCode(participantId: string): Promise<ActivationResult> {
  return request<ActivationResult>(
    `/admin/participants/${encodeURIComponent(participantId)}/activation-code`,
    { method: 'POST' },
  )
}

/**
 * 重置密码。
 *
 * 生成一个符合密码策略的临时密码并返回明文（同样只此一次），
 * 同时撤销该账号的全部会话。对尚未激活的账号，这一步等于替对方完成激活。
 */
export function resetParticipantPassword(participantId: string): Promise<ResetResult> {
  return request<ResetResult>(
    `/admin/participants/${encodeURIComponent(participantId)}/reset-password`,
    { method: 'POST' },
  )
}

/**
 * 匿名化（§8.3 末段）。
 *
 * 已有正式记录的参赛者不允许删除，只能抹除身份。不可逆，
 * 所以服务端要求新鲜认证（REAUTH_REQUIRED 由 client.ts 静默处理）并强制填原因。
 */
export function anonymizeParticipant(
  participantId: string,
  body: AnonymizeBody,
): Promise<AnonymizeResult> {
  return request<AnonymizeResult>(
    `/admin/participants/${encodeURIComponent(participantId)}/anonymize`,
    { method: 'POST', body },
  )
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

/**
 * 上传并预览名单。
 *
 * 用 multipart 传文件，字段名固定为 `file`（服务端明确要求）。
 * 这里不走 upload.ts 的 XHR —— 那是为了打卡的图片进度条才存在的东西，
 * 一份几百 KB 的 CSV 在桌面端不需要进度。
 *
 * 返回的 `batch_id` 是下一步的凭据：服务端会重新读取暂存文件并重新解析，
 * **任何客户端带来的行数据都不参与写入**（§7.1）。
 */
export function previewImport(file: File): Promise<PreviewResult> {
  const form = new FormData()
  form.append('file', file)
  // 不设 Content-Type：multipart 的 boundary 必须由浏览器自己生成
  return request<PreviewResult>('/admin/participants/import/preview', {
    method: 'POST',
    rawBody: form,
  })
}

/**
 * 确认导入。
 *
 * 同一个 batch_id 只能提交一次 —— 重复提交会重复发放激活码，服务端会挡。
 * 提交成功后返回的 activation_codes 同样是**一次性明文**。
 */
export function commitImport(body: CommitBody): Promise<CommitResult> {
  return request<CommitResult>('/admin/participants/import/commit', { method: 'POST', body })
}

/** 下载名单模板。文件带 BOM，Excel 打开中文不乱码 */
export function downloadTemplate(): Promise<void> {
  return downloadCsv('/admin/participants/template.csv', 'participants-template.csv')
}

/**
 * 导出参赛者名册。
 *
 * 走带鉴权的下载：导出接口在超管守卫之后，`<a href>` 带不上 Bearer 令牌。
 */
export function exportParticipants(): Promise<void> {
  return downloadCsv('/admin/exports/participants.csv', 'participants.csv')
}

/**
 * 导出激活状态。
 *
 * 注意导出的是**状态**（无/未使用/已使用/已过期）而不是码本身 ——
 * 库里只有哈希，明文永远导不出来（§13）。
 */
export function exportActivationCodes(): Promise<void> {
  return downloadCsv('/admin/participants/activation-codes.csv', 'activation-codes.csv')
}
