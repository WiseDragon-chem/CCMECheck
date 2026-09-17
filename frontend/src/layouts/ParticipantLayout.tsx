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
 * 断点是 992px：以下走手机形态（内容铺满、底部导航），以上走桌面形态
 * （内容居中在一列 1040px 的壳里、顶部横条导航、各页按需分栏）。
 * 具体规则全部在 global.css 的「参赛者端 · 桌面适配」块里。
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
  /*
    两个 <nav> 同时存在于 DOM，靠 CSS 的 display 二选一：手机是底部四宫格，
    桌面是顶部横条。不可见的那个是 display:none，读屏与 Tab 都不会碰到它。

    「导航文案在 DOM 里有两份」这件事要知道：getByRole 走无障碍树，安全；
    getByText 不过滤可见性，将来若有人对「记录」「排行榜」这类文案写
    getByText，strict mode 会因两份匹配而报错 —— 那与布局无关，
    到时候用 getByRole('link') 或 .first() 解决。
  */
  return (
    <div className="participant-shell participant-shell--with-nav">
      <nav className="top-nav" aria-label={zh.nav.label}>
        {/* 内层承接内容列的对齐：顶栏铺满视口，链接与内容列右缘对齐 */}
        <div className="top-nav__inner">
          <NavItems />
        </div>
      </nav>

      <Outlet />

      <nav className="bottom-nav" aria-label={zh.nav.label}>
        <NavItems />
      </nav>
    </div>
  )
}
