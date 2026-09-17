import { describe, expect, it } from 'vitest'
import ParticipantLayout from './ParticipantLayout'
import { renderWithProviders } from '@/test/renderWithProviders'

/**
 * 参赛者端布局的两个导航容器。
 *
 * 手机与桌面各渲染一份，靠 CSS 的 display 二选一 —— 也就是说四个导航项
 * 在 DOM 里各写了两遍。这类结构最容易出的错是「给一个容器加项时忘了另一个」
 * （两个容器共用 NavItems，所以现在不会了，但这条断言把它钉住）。
 *
 * 注意断言用 DOM 查询而不是 getAllByRole('navigation')：role 查询走无障碍树，
 * 而隐藏的那个 nav 是 display:none、不在树里，只能数到一个。
 */
describe('参赛者端布局', () => {
  it('桌面与手机各有一个导航容器', () => {
    renderWithProviders(<ParticipantLayout />, { route: '/home' })

    expect(document.querySelectorAll('.top-nav')).toHaveLength(1)
    expect(document.querySelectorAll('.bottom-nav')).toHaveLength(1)
  })

  it('两个容器各渲染全部四个导航项', () => {
    renderWithProviders(<ParticipantLayout />, { route: '/home' })

    // 两份，因为两个容器各一份
    expect(document.querySelectorAll('.nav-item')).toHaveLength(8)

    for (const nav of ['.top-nav', '.bottom-nav']) {
      const items = document.querySelectorAll(`${nav} .nav-item`)
      expect(items, `${nav} 里的导航项数量`).toHaveLength(4)

      const labels = [...items].map((item) => item.textContent)
      expect(labels.join('|')).toContain('首页')
      expect(labels.join('|')).toContain('记录')
      expect(labels.join('|')).toContain('排行榜')
      expect(labels.join('|')).toContain('我的')
    }
  })

  it('当前页对应的导航项带选中态', () => {
    // 选中态由 NavLink 的 isActive 给出，手机与桌面共用同一份判断
    renderWithProviders(<ParticipantLayout />, { route: '/leaderboard' })

    const active = document.querySelectorAll('.nav-item.is-active')
    expect(active).toHaveLength(2) // 两个容器各一个
    for (const item of active) expect(item.textContent).toContain('排行榜')
  })
})
