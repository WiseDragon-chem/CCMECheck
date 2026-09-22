import { request } from '@/api/client'
import type { JsonBody, JsonOk, QueryOf } from '@/api/contract'
import { withQuery } from './query'

/**
 * 后台账号管理（design.md §5「管理管理员账号」）。
 *
 * 与名单模块的区别有两处值得记下来：
 *
 *   1. 这里管的是 reviewer 与 super_admin，参赛者在名单页 —— 两个入口
 *      互不重叠，服务端也各自挡掉了对方的学号。
 *
 *   2. **没有「设置密码」的入口**。初始密码与重置密码都由服务端生成，
 *      明文只在响应里出现一次（§13），因此必须交给 ActivationCodeModal
 *      展示，不能塞进 toast。
 */

type ListQuery = QueryOf<'/api/v1/admin/accounts', 'get'>
type ListResult = JsonOk<'/api/v1/admin/accounts', 'get'>

type CreateBody = JsonBody<'/api/v1/admin/accounts', 'post'>
type CreateResult = JsonOk<'/api/v1/admin/accounts', 'post'>

type UpdateBody = JsonBody<'/api/v1/admin/accounts/{accountId}', 'patch'>
type UpdateResult = JsonOk<'/api/v1/admin/accounts/{accountId}', 'patch'>

type ResetResult = JsonOk<'/api/v1/admin/accounts/{accountId}/reset-password', 'post'>

/** 账号列表。超管在前，同角色内按学号升序 */
export function fetchAccountsList(query: ListQuery): Promise<ListResult> {
  return request<ListResult>(withQuery('/admin/accounts', query))
}

/**
 * 新建后台账号。
 *
 * 三个写接口都要求「新鲜认证」（§13 敏感操作重新验证权限）：令牌年龄超过
 * 5 分钟时服务端回 REAUTH_REQUIRED，client.ts 会静默刷新并重放一次，用户无感。
 * 重放是安全的 —— 守卫在业务处理之前，401 时服务端没有产生任何副作用。
 */
export function createAccount(body: CreateBody): Promise<CreateResult> {
  return request<CreateResult>('/admin/accounts', { method: 'POST', body })
}

/**
 * 改名 / 改角色 / 启用禁用。
 *
 * 禁用会一并撤销该账号的全部登录会话（响应里的 revoked_sessions）；
 * 降级不会 —— 权限每个请求都从库里读，下一个请求即生效。
 * 服务端会拒绝「对自己禁用或降级」，所以前置灰按钮，别指望靠报错兜底。
 */
export function updateAccount(accountId: string, body: UpdateBody): Promise<UpdateResult> {
  return request<UpdateResult>(`/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body,
  })
}

/**
 * 重置密码。
 *
 * 生成一次性新密码（明文只出现这一次）并撤销该账号的全部会话。
 * 服务端拒绝「重置自己的密码」—— 本人改密码走 /auth/change-password，
 * 那条路要求提供当前密码。
 */
export function resetAccountPassword(accountId: string): Promise<ResetResult> {
  return request<ResetResult>(`/admin/accounts/${encodeURIComponent(accountId)}/reset-password`, {
    method: 'POST',
  })
}
