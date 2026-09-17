import { NavLink, Outlet } from 'react-router'
import { BarChartOutlined, HomeOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'

/**
 * 参赛者端布局：手机优先。
 *
 * 与管理后台布局完全分开 —— 后台是桌面端的表格与三栏，
 * 挤进 375px 或把参赛者流程塞进 1280px 的表格里，两边都会难用。
 *
 * 内容宽度手机上铺满、550px 以上居中；桌面上的加宽与重排见
 * global.css 里的桌面适配块。
 */

/** 图标与文案并用 —— design.md §7.3 对无障碍的要求同样适用于导航 */
const NAV_ITEMS = [
  { key: 'home', label: zh.nav.home, to: paths.home, icon: <HomeOutlined /> },
  { key: 'records', label: zh.nav.records, to: paths.records, icon: <UnorderedListOutlined /> },
  { key: 'leaderboard', label: zh.nav.leaderboard, to: paths.leaderboard, icon: <BarChartOutlined /> },
  { key: 'me', label: zh.nav.me, to: paths.me, icon: <UserOutlined /> },
] as const

/** 导航项本身与容器无关：手机底部四宫格与桌面顶部横条共用这一份 */
function NavItems() {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.key}
          to={item.to}
          className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
        >
          <span className="nav-item__icon" aria-hidden>
            {item.icon}
          </span>
          <span className="nav-item__label">{item.label}</span>
        </NavLink>
      ))}
    </>
  )
}

export default function ParticipantLayout() {
  return (
    <div className="participant-shell participant-shell--with-nav">
      <Outlet />

      <nav className="bottom-nav" aria-label={zh.nav.label}>
        <NavItems />
      </nav>
    </div>
  )
}
