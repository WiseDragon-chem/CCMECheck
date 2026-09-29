import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { zh } from '@/locales/zh-CN'
import { renderWithProviders } from '@/test/renderWithProviders'
import SponsorBanner from './SponsorBanner'
import type { SponsorImage } from './sponsorImages'

/**
 * 赞助商展示位。
 *
 * 图全部从 items 注入：构建期的目录在这里是空的，也正是「没有赞助商」
 * 那条分支的真实形态（用 items={[]} 显式覆盖）。
 *
 * 不断言图片**数量**以外的东西：jsdom 里 slick 量到的宽度恒为 0，
 * 任何与像素几何有关的断言在单测里都没有意义，那属于 e2e 的活。
 */
const ONE: SponsorImage[] = [{ src: '/a.png', alt: '化学与分子工程学院' }]
const TWO: SponsorImage[] = [
  { src: '/a.png', alt: '甲' },
  { src: '/b.png', alt: '乙' },
]

describe('SponsorBanner', () => {
  it('没有赞助商时整块不渲染 —— 含那行小字，也不留空位', () => {
    const { container } = renderWithProviders(<SponsorBanner items={[]} />)

    expect(screen.queryByText(zh.sponsor.thanks)).not.toBeInTheDocument()
    expect(container.querySelector('.sponsor')).toBeNull()
  })

  it('有图时渲染小字与图片，alt 用文件名推出来的名字', () => {
    renderWithProviders(<SponsorBanner items={ONE} />)

    expect(screen.getByText(zh.sponsor.thanks)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '化学与分子工程学院' })).toBeInTheDocument()
  })

  /**
   * 文案被拆成「小字 + 加粗的名字」两段。整行都加粗就分不出主次，
   * 所以这里钉住的是**加粗只落在名字上**，而不只是名字出现在页面上。
   */
  it('只把赞助商名字加粗，小字不加粗', () => {
    const { container } = renderWithProviders(<SponsorBanner items={ONE} />)

    const thanks = container.querySelector('.sponsor__thanks')
    expect(thanks?.querySelector('strong')).toHaveTextContent(zh.sponsor.thanksBrand)
    expect(thanks).toHaveTextContent(`${zh.sponsor.thanks}${zh.sponsor.thanksBrand}`)
  })

  /**
   * 尺寸由图片自己撑（CSS 的 width: 100% + height: auto），**JS 不再往 DOM 里
   * 写高度**。上一版是在画面框上挂一个 --sponsor-height 像素值 —— 这条钉住的
   * 就是它没有被请回来。像素几何本身归 e2e（见 e2e/layout.spec.ts）。
   *
   * 只查高度：slick 自己会给图片写 `width: 100%; display: inline-block`，
   * 那是它的排版机制，与这条规则无关。
   */
  it('赞助位里没有任何行内高度', () => {
    const { container } = renderWithProviders(<SponsorBanner items={TWO} />)

    const styled = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
    expect(styled.length, '一个带行内样式的元素都没有，这条断言就失去意义了').toBeGreaterThan(0)
    for (const el of styled) {
      expect(el.getAttribute('style'), `${el.className} 上不该有行内高度`).not.toMatch(/height/i)
    }
  })

  it('只有一家时不套轮播：没有圆点', () => {
    const { container } = renderWithProviders(<SponsorBanner items={ONE} />)

    expect(container.querySelector('.slick-dots')).toBeNull()
  })

  it('多家时也没有指示点 —— 那一排横条看着像滚动条，产品要求去掉', () => {
    const { container } = renderWithProviders(<SponsorBanner items={TWO} />)

    expect(container.querySelector('.slick-dots')).toBeNull()
    expect(screen.getByRole('img', { name: '甲' })).toBeInTheDocument()
  })
})
