import { paths } from './paths'

/**
 * 角色与落地页。
 *
 * 单独成模块而不是放在 guards.tsx 里：守卫文件导出的是组件，
 * 一旦混入普通函数，热更新就会退化成整页刷新（react-refresh 的限制）。
 */

/**
 * 角色等级，与后端 `ROLE_LEVEL` 一致。
 *
 * 这里复制一份而不是从契约推导，是因为 OpenAPI 只描述数据形状，
 * 不表达「reviewer 高于 participant」这种序关系 —— 它不是一个能生成出来的东西。
 * 真正的权限判定在后端（design.md §5），这里只决定渲染哪一套界面。
 */
export const ROLE_LEVEL: Record<string, number> = {
  participant: 0,
  reviewer: 1,
  super_admin: 2,
}

export function roleAtLeast(role: string | undefined, min: 'participant' | 'reviewer' | 'super_admin'): boolean {
  return (ROLE_LEVEL[role ?? 'participant'] ?? 0) >= (ROLE_LEVEL[min] ?? 0)
}

/**
 * 登录后该落到哪一页。
 *
 * 审核员与超管落到后台 —— 他们是来干活的，不是来打卡的。
 * 参赛者落到主页面。
 */
export function landingFor(role: string | undefined): string {
  return roleAtLeast(role, 'reviewer') ? paths.admin.dashboard : paths.home
}
