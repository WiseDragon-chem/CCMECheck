import { create } from 'zustand'
import { refreshAccessToken, setAuthLostHandler } from '@/api/client'
import * as authApi from '@/api/endpoints/auth'
import { queryClient } from '@/api/queryClient'
import { clearAccessToken, setAccessToken } from '@/api/tokenStore'
import type { AuthResponse, PublicUser } from '@/api/types'

/**
 * 登录态。
 *
 * 只放「我是谁」——服务端数据归 TanStack Query，这里不重复缓存。
 * 访问令牌也不在这里：它在 tokenStore 的内存变量里，
 * 这样 api/client.ts 不必依赖 React 就能取到它。
 */

export type AuthStatus =
  /** 启动中：正在用刷新令牌换访问令牌，还不知道是否已登录 */
  | 'booting'
  | 'authenticated'
  | 'anonymous'

interface AuthState {
  status: AuthStatus
  user: PublicUser | null

  /** 用响应里的令牌与用户信息落定登录态 */
  applySession: (response: AuthResponse) => void
  /** 清空登录态（退出、被踢、令牌彻底失效） */
  clearSession: () => void

  login: (studentId: string, password: string) => Promise<PublicUser>
  activate: (studentId: string, activationCode: string, password: string) => Promise<PublicUser>
  logout: () => Promise<void>
  /** 应用启动时调用：用 HttpOnly Cookie 里的刷新令牌恢复登录态 */
  bootstrap: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,

  applySession: (response) => {
    setAccessToken(response.access_token, response.expires_in)
    set({ user: response.user, status: 'authenticated' })
  },

  clearSession: () => {
    clearAccessToken()
    // 服务端缓存全部作废：下一个人登录时不该看到上一个人的数据
    queryClient.clear()
    set({ user: null, status: 'anonymous' })
  },

  login: async (studentId, password) => {
    const response = await authApi.login({ student_id: studentId, password })
    get().applySession(response)
    return response.user
  },

  activate: async (studentId, activationCode, password) => {
    const response = await authApi.activate({
      student_id: studentId,
      activation_code: activationCode,
      password,
    })
    get().applySession(response)
    return response.user
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // 退出接口本身失败（网络断了、令牌早过期了）不该把用户卡住 ——
      // 本地状态必须清掉，否则会出现「看起来已登录但什么都请求不了」
    } finally {
      get().clearSession()
    }
  },

  bootstrap: async () => {
    try {
      const token = await refreshAccessToken()
      void token
      // 刷新只换回令牌，用户信息要单独取 —— 顺便验证令牌确实可用
      const me = await authApi.fetchMe()
      set({ user: me.user, status: 'authenticated' })
    } catch {
      // 没有有效的刷新令牌（首次访问、已过期、已撤销）都走这里，属正常情况
      clearAccessToken()
      set({ user: null, status: 'anonymous' })
    }
  },
}))

/**
 * 令牌彻底失效时（会话被撤销、密码已变更、账号被禁用），
 * 拦截器会通知到这里。
 *
 * 注册在模块加载时：client.ts 不认识 React，也不该认识。
 */
setAuthLostHandler(() => {
  const state = useAuthStore.getState()
  if (state.status !== 'anonymous') state.clearSession()
})
