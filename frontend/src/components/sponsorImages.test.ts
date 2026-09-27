import { describe, expect, it } from 'vitest'
import { zh } from '@/locales/zh-CN'
import { buildSponsorImages } from './sponsorImages'

/**
 * 赞助商图片的整理规则。
 *
 * 测的是纯函数：真实的 glob 在构建期就定死了，测试没法往那个目录里塞图，
 * 所以「发现」与「整理」被拆开，这里盯住后者 —— 于是**目录是空的也不影响
 * 这些用例的覆盖**。
 */
describe('buildSponsorImages', () => {
  it('按文件名排序 —— 序号前缀就是播放顺序', () => {
    const images = buildSponsorImages({
      '../assets/sponsors/02-乙.png': '/b.png',
      '../assets/sponsors/01-甲.png': '/a.png',
      '../assets/sponsors/10-丙.png': '/c.png',
    })

    expect(images.map((image) => image.src)).toEqual(['/a.png', '/b.png', '/c.png'])
  })

  it('alt 取文件名去掉序号与扩展名之后的部分', () => {
    const [image] = buildSponsorImages({ '../assets/sponsors/01-化学与分子工程学院.png': '/a.png' })

    expect(image?.alt).toBe('化学与分子工程学院')
  })

  it('没有序号前缀时也用整个文件名', () => {
    const [image] = buildSponsorImages({ '../assets/sponsors/某某科技.jpg': '/a.jpg' })

    expect(image?.alt).toBe('某某科技')
  })

  it('文件名给不出名字时退回通用描述 —— 空 alt 会让这张图在无障碍树里消失', () => {
    const [image] = buildSponsorImages({ '../assets/sponsors/01-.png': '/a.png' })

    expect(image?.alt).toBe(zh.sponsor.alt)
  })

  it('目录为空时得到空列表（调用方据此整块不渲染）', () => {
    expect(buildSponsorImages({})).toEqual([])
  })
})
