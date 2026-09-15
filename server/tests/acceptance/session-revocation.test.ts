import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login, type AuthSession } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.13 修改密码后已有长期会话全部失效
 * design.md §7.2 用户主动退出、修改密码或管理员禁用账号后，相关刷新令牌全部失效
 *
 * 三条失效路径（改密 / 退出 / 禁用）都会走到同一处判定，因此放在同一个文件里：
 * 「长期会话」指 refresh_sessions 里的行，「已有会话全部失效」既包括刷新令牌，
 * 也包括改密之前签发、尚未过期的访问令牌（authenticate 里的 iat 判定）。
 */
describe('会话撤销', () => {
  const db = getPrismaClient()
  const NEW_PASSWORD = 'NewPassw0rd456'

  let campaignId: string
  let participantId: string
  let participantUserId: string
  let adminToken: string

  beforeEach(async () => {
    // 固定时间是为了能明确地「往前走一段」：改密时间必须严格晚于旧令牌的签发时间
    freezeTimeAt(cst('2026-10-01T10:00:00'))

    const { campaign } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    participantUserId = user.id
    const participant = await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
  })

  afterEach(() => {
    unfreezeTime()
  })

  /**
   * 从 set-cookie 里取出 name=value。
   * set-cookie 还带着 Path/HttpOnly/SameSite 等属性，整串塞进 Cookie 头会变成非法请求。
   */
  function cookieOf(session: AuthSession): string {
    const raw = session.cookies[0]
    if (!raw) throw new Error('登录响应里没有 set-cookie')
    return raw.split(';')[0]!
  }

  function refresh(cookie: string) {
    return api().post('/api/v1/auth/refresh').set('Cookie', cookie)
  }

  it('§16.13 改密后两台设备的长期会话同时失效，改密前的访问令牌也不再可用', async () => {
    // 模拟两台设备：两次登录各自拿到独立的刷新会话
    const deviceA = await login('2026001', TEST_PASSWORD)
    const deviceB = await login('2026001', TEST_PASSWORD)
    expect(cookieOf(deviceA)).not.toBe(cookieOf(deviceB))

    const sessionsBefore = await db.refreshSession.findMany({
      where: { userId: participantUserId, revokedAt: null },
      select: { id: true },
    })
    expect(sessionsBefore).toHaveLength(2)

    // 时间前移，确保 password_changed_at 严格晚于旧令牌的 iat
    freezeTimeAt(cst('2026-10-01T11:00:00'))

    const changed = await authed(deviceA.accessToken)
      .post('/api/v1/auth/change-password')
      .send({ current_password: TEST_PASSWORD, new_password: NEW_PASSWORD })

    expect(changed.status, JSON.stringify(changed.body)).toBe(200)

    // §7.2「已有长期会话全部失效」指的是改密之前存在的会话。
    // 实现会在撤销完毕后为当前设备补发一个新会话（用户刚证明过自己知道密码，
    // 不该被立刻踢下线），所以这里断言的是「旧会话全部失效」而不是「一条会话都不剩」。
    const sessionsAfter = await db.refreshSession.findMany({
      where: { userId: participantUserId, revokedAt: null },
      select: { id: true },
    })
    const survivorIds = sessionsAfter.map((session) => session.id)
    for (const old of sessionsBefore) {
      expect(survivorIds, `改密前的会话 ${old.id} 仍然有效`).not.toContain(old.id)
    }
    expect(sessionsAfter).toHaveLength(1)

    // 两台设备的旧刷新令牌都换不到新令牌
    for (const device of [deviceA, deviceB]) {
      const response = await refresh(cookieOf(device))
      expect(response.status, JSON.stringify(response.body)).toBe(401)
      expect(response.body.code).toBe('TOKEN_INVALID')
    }

    // §7.2 的 iat 规则：访问令牌本身还没过期，但签发时间早于改密时刻，必须失效。
    // 这里断言到具体文案，是为了证明拦下它的是「密码已变更」这条判定，
    // 而不是另有其因（会话被撤销同样返回 TOKEN_INVALID）
    const staleAccess = await authed(deviceA.accessToken).get('/api/v1/users/me')
    expect(staleAccess.status, JSON.stringify(staleAccess.body)).toBe(401)
    expect(staleAccess.body.code).toBe('TOKEN_INVALID')
    expect(staleAccess.body.message).toContain('密码')

    // 改密响应里补发的新令牌立即可用（否则用户改完密码就被踢下线）
    const fresh = await authed(changed.body.access_token as string).get('/api/v1/users/me')
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200)

    // 新密码可以登录，旧密码不再可用
    const relogin = await login('2026001', NEW_PASSWORD)
    expect(relogin.accessToken).toBeTruthy()

    const oldPassword = await api().post('/api/v1/auth/login').send({ student_id: '2026001', password: TEST_PASSWORD })
    expect(oldPassword.status, JSON.stringify(oldPassword.body)).toBe(401)
    expect(oldPassword.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('§7.2 退出登录只撤销当前会话的刷新令牌', async () => {
    const deviceA = await login('2026001', TEST_PASSWORD)
    const deviceB = await login('2026001', TEST_PASSWORD)

    const logout = await api().post('/api/v1/auth/logout').set('Cookie', cookieOf(deviceA))
    expect(logout.status).toBe(204)

    const revoked = await refresh(cookieOf(deviceA))
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(401)
    expect(revoked.body.code).toBe('TOKEN_INVALID')

    // 另一台设备不受影响：退出是会话级的，不是账号级的
    const other = await refresh(cookieOf(deviceB))
    expect(other.status, JSON.stringify(other.body)).toBe(200)
    expect(other.body.access_token).toBeTruthy()
  })

  it('§7.2 管理员禁用参赛者后，该账号的会话与访问令牌立即失效', async () => {
    const device = await login('2026001', TEST_PASSWORD)

    const disabled = await authed(adminToken)
      .patch(`/api/v1/admin/participants/${participantId}`)
      .send({ status: 'disabled' })

    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200)
    expect(disabled.body.participant.status).toBe('disabled')
    // §8.3：禁用必须立刻生效，返回的 revoked_sessions 就是这次撤销的会话数
    expect(disabled.body.revoked_sessions).toBe(1)

    const stored = await db.user.findUnique({ where: { id: participantUserId } })
    expect(stored!.status).toBe('disabled')

    const refreshed = await refresh(cookieOf(device))
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(401)
    expect(refreshed.body.code).toBe('TOKEN_INVALID')

    // 未过期的访问令牌同样被 authenticate 挡下
    const staleAccess = await authed(device.accessToken).get('/api/v1/users/me')
    expect(staleAccess.status, JSON.stringify(staleAccess.body)).toBe(401)
    expect(staleAccess.body.code).toBe('ACCOUNT_DISABLED')

    // 被禁用的账号无法再登录
    const relogin = await api().post('/api/v1/auth/login').send({ student_id: '2026001', password: TEST_PASSWORD })
    expect(relogin.status, JSON.stringify(relogin.body)).toBe(401)
    expect(relogin.body.code).toBe('ACCOUNT_DISABLED')
  })

  it('改密时提供错误的当前密码不产生任何撤销', async () => {
    const device = await login('2026001', TEST_PASSWORD)
    freezeTimeAt(cst('2026-10-01T11:00:00'))

    const response = await authed(device.accessToken)
      .post('/api/v1/auth/change-password')
      .send({ current_password: 'WrongPassword1', new_password: NEW_PASSWORD })

    expect(response.status, JSON.stringify(response.body)).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')

    // 失败不应有副作用：旧会话仍然可用
    expect(await db.refreshSession.count({ where: { userId: participantUserId, revokedAt: null } })).toBe(1)
    const stillWorks = await refresh(cookieOf(device))
    expect(stillWorks.status, JSON.stringify(stillWorks.body)).toBe(200)
  })

  it('刷新令牌轮换后旧刷新令牌立即失效（§7.2 一次性刷新）', async () => {
    const device = await login('2026001', TEST_PASSWORD)
    const oldCookie = cookieOf(device)

    const rotated = await refresh(oldCookie)
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200)

    const replay = await refresh(oldCookie)
    expect(replay.status, JSON.stringify(replay.body)).toBe(401)
    expect(replay.body.code).toBe('TOKEN_INVALID')
  })

  it('未登录不能修改密码', async () => {
    const response = await api()
      .post('/api/v1/auth/change-password')
      .send({ current_password: TEST_PASSWORD, new_password: NEW_PASSWORD })

    expect(response.status, JSON.stringify(response.body)).toBe(401)
    expect(response.body.code).toBe('UNAUTHENTICATED')
  })
})
