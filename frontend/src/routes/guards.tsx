import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuthStore } from '@/stores/auth.store'
import { paths } from './paths'

/**
 * 路由守卫。
 *
 * design.md §5 说得很明确：**前端隐藏入口不算权限控制**，
 * 真正的边界在后端每个接口里。这里做的只是体验层的事 ——
 * 没登录就别渲染一个注定全是 401 的页面。
 *
 * 因此即使有人手敲 URL 绕过守卫，服务端依然会拒绝；而每个页面
 * 也仍然需要能优雅地渲染 403。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  // 启动中：还不能判断是否已登录。返回 null 而不是跳登录页，
  // 否则已登录用户刷新页面时会先被甩到 /login 再弹回来。
  if (status === 'booting') return null

  if (status === 'anonymous') {
    // 记住来源，登录后回到原处
    return <Navigate to={paths.login} replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}

/** 已登录用户不该再看到登录页 */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)

  if (status === 'booting') return null
  if (status === 'authenticated') return <Navigate to={paths.home} replace />

  return <>{children}</>
}
