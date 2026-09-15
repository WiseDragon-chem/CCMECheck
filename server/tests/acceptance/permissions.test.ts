import { beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser } from '../helpers/factory.js'

/**
 * design.md §5 用户角色与权限：后端必须在每个受保护接口中验证权限。
 * design.md §16.12 审核员无法修改活动计分规则。
 *
 * 除了逐条断言，这里还有一张覆盖 /admin 全部路由的守卫表 ——
 * 它的价值不在于当下全部通过，而在于将来有人新增管理路由却忘了挂守卫时，
 * 表格里多出的那一行会因为「返回 404 而不是 403」而失败。
 */

interface AdminRoute {
  method: 'get' | 'post' | 'put' | 'patch'
  path: string
  /** 该路由要求的最低角色（§5 权限矩阵对应行） */
  minRole: 'reviewer' | 'super_admin'
  /** §5 标注为「按权限配置」的能力项 */
  capability?: 'exports.run'
}

/**
 * 参数化路径统一用合法但不存在的 id：
 * 守卫挂在 route() 之前，因此能拿到 403 才说明守卫真的执行了；
 * 若返回 404（找不到记录）就说明请求已经穿过守卫进了业务处理。
 */
const ADMIN_ROUTES: AdminRoute[] = [
  // 配置活动及计分规则 —— §5 仅超级管理员
  { method: 'get', path: '/api/v1/admin/campaign', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/campaign', minRole: 'super_admin' },
  { method: 'put', path: '/api/v1/admin/campaign', minRole: 'super_admin' },
  { method: 'put', path: '/api/v1/admin/campaign/tracks/nonexistent-id', minRole: 'super_admin' },

  // 排行榜维护（重算 / 冻结 / 解冻）—— §8.5 仅超级管理员
  { method: 'post', path: '/api/v1/admin/leaderboards/rebuild', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/leaderboards/freeze', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/leaderboards/unfreeze', minRole: 'super_admin' },

  // 导出数据 —— §5「按权限配置」
  { method: 'get', path: '/api/v1/admin/exports/checkins.csv', minRole: 'reviewer', capability: 'exports.run' },
  { method: 'get', path: '/api/v1/admin/exports/leaderboard.csv', minRole: 'reviewer', capability: 'exports.run' },
  { method: 'get', path: '/api/v1/admin/exports/participants.csv', minRole: 'reviewer', capability: 'exports.run' },

  // 查看审计日志 —— §5 仅超级管理员
  { method: 'get', path: '/api/v1/admin/audit-logs', minRole: 'super_admin' },

  // 定时任务运维视图 —— §14 仅超级管理员
  { method: 'get', path: '/api/v1/admin/jobs/scheduled', minRole: 'super_admin' },
  { method: 'get', path: '/api/v1/admin/jobs/runs', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/jobs/leaderboard_snapshot/run', minRole: 'super_admin' },

  // 后台首页 —— §8.1 审核员与超管都可看
  { method: 'get', path: '/api/v1/admin/dashboard', minRole: 'reviewer' },

  // 名单管理 —— §5 导入参赛名单仅超级管理员
  { method: 'get', path: '/api/v1/admin/participants/template.csv', minRole: 'super_admin' },
  { method: 'get', path: '/api/v1/admin/participants/activation-codes.csv', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/participants/import/preview', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/participants/import/commit', minRole: 'super_admin' },
  { method: 'get', path: '/api/v1/admin/participants', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/participants', minRole: 'super_admin' },
  { method: 'patch', path: '/api/v1/admin/participants/nonexistent-id', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/participants/nonexistent-id/activation-code', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/participants/nonexistent-id/reset-password', minRole: 'super_admin' },

  // 审核 —— §5 审核证明材料、查看全部参赛者记录
  { method: 'get', path: '/api/v1/admin/reviews/queue', minRole: 'reviewer' },
  { method: 'get', path: '/api/v1/admin/reviews/nonexistent-id', minRole: 'reviewer' },
  { method: 'post', path: '/api/v1/admin/reviews/nonexistent-id/approve', minRole: 'reviewer' },
  { method: 'post', path: '/api/v1/admin/reviews/nonexistent-id/reject', minRole: 'reviewer' },

  // 异常处理（补录 / 重开 / 撤销 / 作废 / 积分调整）—— §5 仅超级管理员
  { method: 'post', path: '/api/v1/admin/checkins/nonexistent-id/reopen', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/checkins/nonexistent-id/revoke', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/checkins/nonexistent-id/void', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/checkins/manual', minRole: 'super_admin' },
  { method: 'post', path: '/api/v1/admin/score-adjustments', minRole: 'super_admin' },
]

function label(route: AdminRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`
}

/** 发一个最小请求：守卫先于 route() 的请求体校验执行，空体不会影响 403 的判定 */
function call(token: string, route: AdminRoute) {
  const client = authed(token)
  const request = client[route.method](route.path)
  return route.method === 'get' ? request : request.send({})
}

describe('§5 权限矩阵与 §16.12 审核员无法修改计分规则', () => {
  const db = getPrismaClient()

  let campaignId: string
  let readingTrackId: string
  let participantToken: string
  let reviewerToken: string
  let exporterToken: string
  let adminToken: string

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id
    readingTrackId = tracks.find((track) => track.slug === 'reading')!.id

    const participant = await createUser({ studentId: '2026001', name: '参赛者' })
    await createParticipant({ campaignId, userId: participant.id, className: '化学院一班' })

    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    // §5 的「按权限配置」：默认审核员没有 exports.run，需要超管单独授予
    await createUser({
      studentId: 'exporter1',
      name: '导出员',
      role: 'reviewer',
      capabilities: ['exports.run'],
    })
    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })

    participantToken = (await login('2026001', 'Passw0rd123')).accessToken
    reviewerToken = (await login('reviewer1', 'Passw0rd123')).accessToken
    exporterToken = (await login('exporter1', 'Passw0rd123')).accessToken
    adminToken = (await login('admin1', 'Passw0rd123')).accessToken
  })

  it('§16.12 审核员无法修改活动计分规则', async () => {
    const before = await db.campaignTrack.findFirst({ where: { campaignId, trackId: readingTrackId } })

    const campaignUpdate = await authed(reviewerToken)
      .put('/api/v1/admin/campaign')
      .send({ name: '审核员改掉的活动名' })
    expect(campaignUpdate.status, JSON.stringify(campaignUpdate.body)).toBe(403)
    expect(campaignUpdate.body.code).toBe('ROLE_REQUIRED')

    const trackUpdate = await authed(reviewerToken)
      .put(`/api/v1/admin/campaign/tracks/${readingTrackId}`)
      .send({ daily_points: 999999 })
    expect(trackUpdate.status, JSON.stringify(trackUpdate.body)).toBe(403)
    expect(trackUpdate.body.code).toBe('ROLE_REQUIRED')

    // 被拒绝的不只是响应：库里的配置也必须原封不动
    const after = await db.campaignTrack.findFirst({ where: { campaignId, trackId: readingTrackId } })
    expect(after!.dailyPoints).toBe(before!.dailyPoints)
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } })
    expect(campaign!.name).toBe('测试活动')
  })

  it('参赛者访问任何 /admin 路由都被 403 拦下', async () => {
    for (const route of ADMIN_ROUTES) {
      const response = await call(participantToken, route)
      expect(response.status, label(route)).toBe(403)
      expect(response.body.code, label(route)).toBe('ROLE_REQUIRED')
    }
  })

  it('审核员访问超管专属路由全部被 403 拦下，导出路由按能力配置判定', async () => {
    for (const route of ADMIN_ROUTES) {
      const response = await call(reviewerToken, route)

      if (route.minRole === 'super_admin') {
        expect(response.status, label(route)).toBe(403)
        expect(response.body.code, label(route)).toBe('ROLE_REQUIRED')
        continue
      }

      if (route.capability) {
        // 没有 exports.run 的审核员被能力守卫拦下（§5「按权限配置」）
        expect(response.status, label(route)).toBe(403)
        expect(response.body.code, label(route)).toBe('CAPABILITY_REQUIRED')
      }
    }
  })

  it('审核员可以查看审核队列与后台首页', async () => {
    const queue = await authed(reviewerToken).get('/api/v1/admin/reviews/queue')
    expect(queue.status, JSON.stringify(queue.body)).toBe(200)

    const dashboard = await authed(reviewerToken).get('/api/v1/admin/dashboard')
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200)
  })

  it('被授予 exports.run 的审核员可以导出数据', async () => {
    const response = await authed(exporterToken).get('/api/v1/admin/exports/participants.csv')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    // 导出内容带 BOM，否则 Windows 版 Excel 打开中文会乱码
    expect(response.text.startsWith('﻿')).toBe(true)
  })

  it('超级管理员可以访问超管专属路由', async () => {
    for (const path of ['/api/v1/admin/campaign', '/api/v1/admin/audit-logs', '/api/v1/admin/dashboard']) {
      const response = await authed(adminToken).get(path)
      expect(response.status, path).toBe(200)
    }
  })

  it('未登录访问 /admin 路由返回 401', async () => {
    const response = await api().get('/api/v1/admin/campaign')
    expect(response.status, JSON.stringify(response.body)).toBe(401)
    expect(response.body.code).toBe('UNAUTHENTICATED')
  })

  it('参赛者不能借审核接口读取他人的打卡记录', async () => {
    // §5：查看全部参赛者记录仅审核员及以上
    const response = await authed(participantToken).get('/api/v1/admin/reviews/nonexistent-id')
    expect(response.status, JSON.stringify(response.body)).toBe(403)
    expect(response.body.code).toBe('ROLE_REQUIRED')
  })
})
