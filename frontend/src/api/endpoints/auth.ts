import { request } from '../client'
import type { JsonBody, JsonOk } from '../contract'

/**
 * 认证相关接口。
 *
 * 请求体类型全部取自契约 —— 这几个接口的字段名是 snake_case
 * （student_id / activation_code / current_password / new_password），
 * 手写很容易写成 camelCase 而拿到一个 400。
 */

type LoginBody = JsonBody<'/api/v1/auth/login', 'post'>
type LoginResult = JsonOk<'/api/v1/auth/login', 'post'>

type ActivateBody = JsonBody<'/api/v1/auth/activate', 'post'>
type ActivateResult = JsonOk<'/api/v1/auth/activate', 'post'>

type ChangePasswordBody = JsonBody<'/api/v1/auth/change-password', 'post'>
type ChangePasswordResult = JsonOk<'/api/v1/auth/change-password', 'post'>

type MeResult = JsonOk<'/api/v1/users/me', 'get'>

export function login(body: LoginBody): Promise<LoginResult> {
  return request<LoginResult>('/auth/login', { method: 'POST', body })
}

export function activate(body: ActivateBody): Promise<ActivateResult> {
  return request<ActivateResult>('/auth/activate', { method: 'POST', body })
}

export function changePassword(body: ChangePasswordBody): Promise<ChangePasswordResult> {
  return request<ChangePasswordResult>('/auth/change-password', { method: 'POST', body })
}

/**
 * 退出登录。
 *
 * 这个接口**不要求访问令牌有效**（后端如此设计），
 * 所以即使令牌已过期也能正常清掉会话。
 */
export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function fetchMe(): Promise<MeResult> {
  return request<MeResult>('/users/me')
}
