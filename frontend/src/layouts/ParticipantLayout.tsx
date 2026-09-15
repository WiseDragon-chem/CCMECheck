import { NavLink, Outlet } from 'react-router'
import { BarChartOutlined, HomeOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import { paths } from '@/routes/paths'

/**
 * 参赛者端布局：手机优先。
 *
 * 与将来的管理后台布局完全分开 —— 后台是桌面端的表格与三栏，
 * 挤进 375px 或把参赛者流程塞进 1280px 的表格里，两边都会难用。
 *
 * 内容宽度限制在 560px 并居中：手机上铺满，桌面上不至于被拉成一条。
 */

/** 图标与文案并用 —— design.md §7.3 对无障碍的要求同样适用于导航 */
const NAV_ITEMS = [
  { key: 'home', label: '首页', to: paths.home, icon: <HomeOutlined /> },
  { key: 'records', label: '记录', to: paths.records, icon: <UnorderedListOutlined /> },
  { key: 'leaderboard', label: '排行榜', to: paths.leaderboard, icon: <BarChartOutlined /> },
  { key: 'me', label: '我的', to: paths.me, icon: <UserOutlined /> },
] as const

export default function ParticipantLayout() {
  return (
    <div className="participant-shell participant-shell--with-nav">
      <Outlet />

      <nav className="bottom-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}
          >
            <span className="bottom-nav__icon" aria-hidden>
              {item.icon}
            </span>
            <span className="bottom-nav__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
