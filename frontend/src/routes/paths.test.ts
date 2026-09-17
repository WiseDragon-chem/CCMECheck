import { describe, expect, it } from 'vitest'
import { matchNavKey, paths } from './paths'

/**
 * 导航项的选中态。
 *
 * 这组断言来自一个真实缺陷：`items.find(pathname.startsWith(item.key))`
 * 里 `/admin` 排在第一位，于是它永远命中，侧栏的「概览」从头到尾高亮着 ——
 * 点「审核」页面换了，高亮没换，而界面上没有任何报错。
 */

const KEYS = [
  paths.admin.dashboard,
  paths.admin.review,
  paths.admin.participants,
  paths.admin.ops,
  paths.admin.audit,
]

describe('导航选中态', () => {
  it('概览页选中概览', () => {
    expect(matchNavKey(paths.admin.dashboard, KEYS)).toBe(paths.admin.dashboard)
  })

  it('审核页选中的是审核，而不是排在它前面的概览', () => {
    expect(matchNavKey(paths.admin.review, KEYS)).toBe(paths.admin.review)
  })

  it('其余各页各自命中', () => {
    for (const key of KEYS) {
      expect(matchNavKey(key, KEYS)).toBe(key)
    }
  })

  it('审核页的深链落到审核上', () => {
    // /admin/review/:entryId
    expect(matchNavKey(paths.admin.reviewEntry('entry_abc'), KEYS)).toBe(paths.admin.review)
  })

  it('子路径属于它的父项', () => {
    expect(matchNavKey('/admin/participants/anything', KEYS)).toBe(paths.admin.participants)
  })

  it('仅仅是字符串前缀相同的路径不误匹配', () => {
    // 用 startsWith(key) 匹配时 /adminxxx 会被当成后台首页
    expect(matchNavKey('/adminxxx', KEYS)).toBeUndefined()
    expect(matchNavKey('/admin-review', KEYS)).toBeUndefined()
  })

  it('不在导航里的路径返回 undefined，而不是硬塞一个选中项', () => {
    expect(matchNavKey('/home', KEYS)).toBeUndefined()
  })

  it('审核员敲超管入口时命中兜底的概览 —— 因为守卫本来就会把他送到那里', () => {
    // 审核员的导航只有概览与审核。他手敲 /admin/ops 时，RequireRole 会把他
    // 重定向回 /admin，所以「概览」高亮是对的；关键是不要落到「审核」上 ——
    // 那会让人以为自己在一个有权限的页面上。
    const reviewerKeys = [paths.admin.dashboard, paths.admin.review]
    expect(matchNavKey(paths.admin.ops, reviewerKeys)).toBe(paths.admin.dashboard)
  })
})
