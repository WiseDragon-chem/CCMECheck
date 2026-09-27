import { zh } from '@/locales/zh-CN'

/**
 * 赞助商图片的发现与整理。
 *
 * 图片放在 `src/assets/sponsors/`，往目录里丢文件就出现、删掉就消失，
 * 增删赞助商不必改代码。目录约定（命名、尺寸、顺序）见那个目录里的 README。
 *
 * 为什么走构建期资源、而不是服务端那套私有存储 + 签名地址：赞助图是公开的、
 * 对所有人一样的静态资源，与私有的打卡证明是两类东西（`frontend/README.md`
 * 的目录说明里记了这次偏离的理由）。放进模块图还顺带拿到内容哈希 ——
 * 换了图不会被浏览器缓存的旧图挡住。
 */

export interface SponsorImage {
  src: string
  alt: string
}

/**
 * 目录里的全部图片。
 *
 * 路径必须是字面量相对路径：`@` 别名在 glob 里不解析。
 * `eager` + `query: '?url'` 让每张图直接给出一条最终 URL（构建后带哈希）。
 *
 * 显式写 `<string>` 是必须的：eager 这条路上 Vite 的类型推不出值类型，
 * 不写就成了 `Record<string, unknown>`，下面还得再断言一次。
 */
const modules = import.meta.glob<string>('../assets/sponsors/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

/**
 * 文件名去掉序号前缀后的部分，就是这张图的 alt。
 *
 * 赞助商 logo 对读屏用户来说就是「某某单位的图」，而文件名是组织者手上
 * 唯一现成的名字（约定见目录 README）。名字给不出来时退回一句通用描述 ——
 * 空 alt 会让这张图在无障碍树里直接消失。
 */
function altOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const name = base
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[-_]/, '')
    .trim()
  return name || zh.sponsor.alt
}

/**
 * 排序 + 推导 alt。
 *
 * 抽成纯函数是为了能单测：真实的 glob 在构建期就定死了，测试没法往那个
 * 目录里塞图，只好把「整理」这一步与「发现」分开。
 */
export function buildSponsorImages(modules: Record<string, string>): SponsorImage[] {
  return Object.entries(modules)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, src]) => ({ src, alt: altOf(path) }))
}

export const SPONSOR_IMAGES = buildSponsorImages(modules)
