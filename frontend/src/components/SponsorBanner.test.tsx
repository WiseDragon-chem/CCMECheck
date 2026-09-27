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
