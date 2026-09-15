import { Navigate, createBrowserRouter } from 'react-router'
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
import { RedirectIfAuthenticated, RequireAuth } from './guards'
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
  { path: '*', element: <NotFoundPage /> },
])
