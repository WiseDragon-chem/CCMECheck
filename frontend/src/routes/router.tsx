import { Suspense, lazy } from 'react'
import { Navigate, createBrowserRouter } from 'react-router'
import { Spin } from 'antd'
import LoginPage from '@/features/auth/pages/LoginPage'
import ActivatePage from '@/features/auth/pages/ActivatePage'
import ProfilePage from '@/features/auth/pages/ProfilePage'
import HomePage from '@/features/checkin/pages/HomePage'
import RecordsPage from '@/features/checkin/pages/RecordsPage'
import RecordDetailPage from '@/features/checkin/pages/RecordDetailPage'
import SubmitPage from '@/features/checkin/pages/SubmitPage'
import LeaderboardPage from '@/features/leaderboard/pages/LeaderboardPage'
import ParticipantLayout from '@/layouts/ParticipantLayout'
import ErrorPage from '@/pages/ErrorPage'
import NotFoundPage from '@/pages/NotFoundPage'
import { RequireAuth, RequireRole, RedirectIfAuthenticated } from './guards'
import { paths } from './paths'

/**
 * 路由表。
 *
 * 用 React Router 的数据模式而不是框架模式：后者自带 Vite 插件与
 * 面向 SSR 的构建，而这是一个对接既有 API 的内部 SPA，用不上。
 *
 * 页面的数据都在 TanStack Query 里，所以没有用路由 loader ——
 * 两套数据获取机制并存会让人分不清某个数据到底从哪来。
 */

/**
 * 整棵管理后台子树懒加载。
 *
 * 参赛者不该为了打卡下载 antd 的 Table/DatePicker 与整个后台代码 ——
 * 这是 design.md §10.1「优先保证手机端打卡体验」在工程上的直接落点。
 * 后台本身也是桌面优先的重界面，用不到的人没必要付这份体积。
 */
const AdminLayout = lazy(() => import('@/layouts/AdminLayout'))
const AdminDashboardPage = lazy(() => import('@/features/admin/pages/DashboardPage'))
const AdminReviewPage = lazy(() => import('@/features/admin/pages/ReviewPipelinePage'))
const AdminOpsPage = lazy(() => import('@/features/admin/pages/OpsPage'))
const AdminAuditPage = lazy(() => import('@/features/admin/pages/AuditLogPage'))

/** 懒加载 chunk 到达前的等待态 */
function LazyFallback() {
  return (
    <div className="centered-page">
      <Spin />
    </div>
  )
}

export const router = createBrowserRouter([
  {
    path: paths.login,
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: paths.activate,
    element: (
      <RedirectIfAuthenticated>
        <ActivatePage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <ParticipantLayout />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to={paths.home} replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'checkin/:track', element: <SubmitPage /> },
      { path: 'records', element: <RecordsPage /> },
      { path: 'records/:entryId', element: <RecordDetailPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      { path: 'me', element: <ProfilePage /> },
    ],
  },

  {
    path: '/admin',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <RequireAuth>
          <RequireRole min="reviewer">
            <AdminLayout />
          </RequireRole>
        </RequireAuth>
      </Suspense>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'review', element: <AdminReviewPage /> },
      // 深链直接定位到某一条：审核页从路由参数里取初始光标
      { path: 'review/:entryId', element: <AdminReviewPage /> },
      /*
        异常处理与审计日志是超管专属（§5）。导航里已经按角色隐藏了入口，
        但那条隐藏只是体验层 —— 不在这里再挡一道，审核员手敲 URL 就能打开
        一个每点一次都报 403 的页面，而他会以为是自己操作错了。
      */
      {
        path: 'ops',
        element: (
          <RequireRole min="super_admin">
            <AdminOpsPage />
          </RequireRole>
        ),
      },
      {
        path: 'audit',
        element: (
          <RequireRole min="super_admin">
            <AdminAuditPage />
          </RequireRole>
        ),
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
