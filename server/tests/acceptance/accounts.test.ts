import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login, type AuthSession } from '../helpers/app.js'
import { createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * 后台账号管理（design.md §5「管理管理员账号」）。
 *
 * 三条要在这里钉住的规则：平权（没有「主管理员」）、不得对自己执行禁用/降级/重置、
 * 系统始终保留至少一个活跃超管。
 *
 * 关于时钟：`requireFreshAuth` 比的是「令牌签发时刻与当前时刻的距离」（300 秒），
 * 因此**冻结时间之后必须重新登录**，否则请求会先被 REAUTH_REQUIRED 拦下，
 * 测不到真正想测的规则（同样的坑在 checkin-deadline.test.ts:178 有注释）。
 * 需要往前走的用例都在前移之后重新登录，见「重置密码」与「新鲜认证」两例。
 */
describe('后台账号管理', () => {
  const db = getPrismaClient()

  let adminId: string
  let adminSession: AuthSession

  /** 从 set-cookie 里取出 name=value；整串塞进 Cookie 头会变成非法请求 */
  function cookieOf(session: AuthSession): string {
    const raw = session.cookies[0]
    if (!raw) throw new Error('登录响应里没有 set-cookie')
    return raw.split(';')[0]!
  }

  function createAccountAs(token: string, body: Record<string, unknown>) {
    return authed(token).post('/api/v1/admin/accounts').send(body)
  }

  beforeEach(async () => {
    freezeTimeAt(cst('2026-10-01T10:00:00'))
    const admin = await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminId = admin.id
    adminSession = await login('admin1', TEST_PASSWORD)
  })

  afterEach(() => {
    unfreezeTime()
  })

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  it('创建审核员：返回一次性密码，用它可以直接登录', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
    })

    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.account).toMatchObject({
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
      status: 'active',
      activated: true,
    })

    const password = created.body.password as string
    expect(password.length).toBeGreaterThanOrEqual(8)

    const stored = await db.user.findUniqueOrThrow({ where: { studentId: 'reviewer1' } })
    expect(stored.status).toBe('active')
    expect(stored.passwordHash).not.toBeNull()
    // 库里只有哈希，明文不落库
    expect(stored.passwordHash).not.toBe(password)
    expect(stored.passwordChangedAt).not.toBeNull()

    const session = await login('reviewer1', password)
    expect(session.userId).toBe(stored.id)
  })

  it('创建超管：新账号能进后台，也能管理原有超管（平权）', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'admin2',
      name: '超级管理员乙',
      role: 'super_admin',
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)

    const second = await login('admin2', created.body.password as string)

    // 新超管能看到账号列表，且列表里包含原来的超管
    const list = await authed(second.accessToken).get('/api/v1/admin/accounts')
    expect(list.status).toBe(200)
    expect((list.body.items as Array<{ student_id: string }>).map((item) => item.student_id)).toEqual([
      'admin1',
      'admin2',
    ])

    // 并且能降级原来的超管 —— 没有「主管理员」这回事（此时有两个活跃超管，允许）
    const demote = await authed(second.accessToken)
      .patch(`/api/v1/admin/accounts/${adminId}`)
      .send({ role: 'reviewer' })
    expect(demote.status, JSON.stringify(demote.body)).toBe(200)
    expect(demote.body.account.role).toBe('reviewer')
  })

  it('学号已被其他后台账号占用 → 409，且不产生副作用', async () => {
    const before = await db.user.count()
    const response = await createAccountAs(adminSession.accessToken, {
      student_id: 'admin1',
      name: '冒名者',
      role: 'reviewer',
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('DUPLICATE_RECORD')
    expect(await db.user.count()).toBe(before)

    const untouched = await db.user.findUniqueOrThrow({ where: { studentId: 'admin1' } })
    expect(untouched.name).toBe('超级管理员')
  })

  it('学号属于参赛者 → 409', async () => {
    await createUser({ studentId: '2026001', name: '张三' })

    const response = await createAccountAs(adminSession.accessToken, {
      student_id: '2026001',
      name: '张三',
      role: 'reviewer',
    })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('DUPLICATE_RECORD')
  })

  // -------------------------------------------------------------------------
  // 列表
  // -------------------------------------------------------------------------

  it('列表只含后台账号，并给出全局活跃超管数', async () => {
    await createUser({ studentId: '2026001', name: '张三' })
    await createUser({ studentId: 'reviewer1', name: '审核员甲', role: 'reviewer' })

    const response = await authed(adminSession.accessToken).get('/api/v1/admin/accounts')
    expect(response.status).toBe(200)

    // 参赛者不出现；超管排在前（role 降序），同角色内按学号
    expect((response.body.items as Array<{ student_id: string }>).map((item) => item.student_id)).toEqual([
      'admin1',
      'reviewer1',
    ])
    expect(response.body.total).toBe(2)
    expect(response.body.page).toBe(1)
    expect(response.body.page_size).toBe(50)
    expect(response.body.active_super_admin_count).toBe(1)
  })

  it('一次性密码无法通过列表或审计回查', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
    })
    const password = created.body.password as string

    const list = await authed(adminSession.accessToken).get('/api/v1/admin/accounts')
    expect(JSON.stringify(list.body)).not.toContain(password)

    const audits = await db.auditLog.findMany({ where: { action: 'account.create' } })
    expect(audits).toHaveLength(1)
    expect(audits[0]!.afterData ?? '').not.toContain(password)
    expect(audits[0]!.afterData ?? '').not.toContain('password')
  })

  // -------------------------------------------------------------------------
  // 自我保护
  // -------------------------------------------------------------------------

  it('不能对自己执行禁用/降级/重置密码，且都无副作用', async () => {
    const disable = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${adminId}`)
      .send({ status: 'disabled' })
    expect(disable.status, JSON.stringify(disable.body)).toBe(409)
    expect(disable.body.code).toBe('STATE_TRANSITION_INVALID')

    const demote = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${adminId}`)
      .send({ role: 'reviewer' })
    expect(demote.status).toBe(409)
    expect(demote.body.code).toBe('STATE_TRANSITION_INVALID')

    const reset = await authed(adminSession.accessToken).post(
      `/api/v1/admin/accounts/${adminId}/reset-password`,
    )
    expect(reset.status).toBe(409)
    expect(reset.body.code).toBe('STATE_TRANSITION_INVALID')

    const stored = await db.user.findUniqueOrThrow({ where: { id: adminId } })
    expect(stored.status).toBe('active')
    expect(stored.role).toBe('super_admin')
    expect(stored.passwordHash).not.toBeNull()
    // 自我操作被拒时不写审计
    expect(await db.auditLog.count()).toBe(0)
  })

  it('允许给自己改名（改名不改变任何人能做什么）', async () => {
    const renamed = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${adminId}`)
      .send({ name: '新的名字' })

    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect(renamed.body.account.name).toBe('新的名字')
  })

  // -------------------------------------------------------------------------
  // 至少保留一个活跃超管
  // -------------------------------------------------------------------------

  it('有两个活跃超管时，可以禁用其中一个，会话立即失效', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'admin2',
      name: '超级管理员乙',
      role: 'super_admin',
    })
    const secondId = created.body.account.id as string
    const password = created.body.password as string

    // 两台设备登录，验证禁用会一并撤销全部会话
    const deviceA = await login('admin2', password)
    const deviceB = await login('admin2', password)

    const disabled = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${secondId}`)
      .send({ status: 'disabled' })

    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200)
    expect(disabled.body.account.status).toBe('disabled')
    expect(disabled.body.revoked_sessions).toBe(2)

    for (const device of [deviceA, deviceB]) {
      const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', cookieOf(device))
      expect(refreshed.status).toBe(401)
      expect(refreshed.body.code).toBe('TOKEN_INVALID')
    }

    // 未过期的访问令牌同样被 authenticate 挡下
    const stale = await authed(deviceA.accessToken).get('/api/v1/users/me')
    expect(stale.status).toBe(401)
    expect(stale.body.code).toBe('ACCOUNT_DISABLED')

    // 被禁用的账号无法再登录
    const relogin = await api().post('/api/v1/auth/login').send({ student_id: 'admin2', password })
    expect(relogin.status).toBe(401)
    expect(relogin.body.code).toBe('ACCOUNT_DISABLED')
  })

  /**
   * 两个超管同时禁用对方。
   *
   * 注意这条用例**不能**宣称证明了并发安全 —— 适配器在 BEGIN 之前拿的那把
   * per-client 互斥锁会让两个事务在进程内串行化（见 accounts/service.ts 的说明）。
   * 它钉住的是行为：无论谁先提交，事后都不能一个活跃超管都不剩。
   */
  it('两个超管同时禁用对方时，不会把超管清零', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'admin2',
      name: '超级管理员乙',
      role: 'super_admin',
    })
    const secondId = created.body.account.id as string
    const secondToken = (await login('admin2', created.body.password as string)).accessToken

    const [first, second] = await Promise.all([
      authed(adminSession.accessToken).patch(`/api/v1/admin/accounts/${secondId}`).send({ status: 'disabled' }),
      authed(secondToken).patch(`/api/v1/admin/accounts/${adminId}`).send({ status: 'disabled' }),
    ])

    const statuses = [first.status, second.status]
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    // 输的一方要么撞上「最后一个活跃超管」，要么因为自己已被禁用而在认证阶段就被拦下
    expect([401, 409]).toContain(statuses.find((status) => status !== 200))

    const remaining = await db.user.count({ where: { role: 'super_admin', status: 'active' } })
    expect(remaining).toBeGreaterThanOrEqual(1)
  })

  it('从未设置过密码的账号不能启用', async () => {
    const account = await createUser({
      studentId: 'reviewer1',
      name: '无密码账号',
      role: 'reviewer',
      status: 'disabled',
      password: null,
    })

    const enabled = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${account.id}`)
      .send({ status: 'active' })

    expect(enabled.status).toBe(409)
    expect(enabled.body.code).toBe('STATE_TRANSITION_INVALID')
  })

  // -------------------------------------------------------------------------
  // 降级与重置密码
  // -------------------------------------------------------------------------

  it('降级立即生效，但刻意不撤销会话', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'admin2',
      name: '超级管理员乙',
      role: 'super_admin',
    })
    const secondId = created.body.account.id as string
    const second = await login('admin2', created.body.password as string)

    const demoted = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${secondId}`)
      .send({ role: 'reviewer' })

    expect(demoted.status, JSON.stringify(demoted.body)).toBe(200)
    expect(demoted.body.account.role).toBe('reviewer')
    expect(demoted.body.revoked_sessions).toBe(0)

    // 同一张访问令牌下一个请求就失去超管权限（authenticate 每次从库里读 role）
    const forbidden = await authed(second.accessToken).get('/api/v1/admin/accounts')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.code).toBe('ROLE_REQUIRED')

    // 会话本身仍然有效，本人可以以审核员身份继续使用
    const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', cookieOf(second))
    expect(refreshed.status).toBe(200)
  })

  it('重置密码：新密码可登录，旧密码、旧会话与旧令牌全部失效', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
    })
    const accountId = created.body.account.id as string
    const oldPassword = created.body.password as string
    const device = await login('reviewer1', oldPassword)

    // 时间前移，确保 password_changed_at 严格晚于旧令牌的 iat；
    // 冻结之后必须重新登录，否则会先被新鲜认证拦下
    freezeTimeAt(cst('2026-10-01T11:00:00'))
    const freshToken = (await login('admin1', TEST_PASSWORD)).accessToken

    const reset = await authed(freshToken).post(`/api/v1/admin/accounts/${accountId}/reset-password`)
    expect(reset.status, JSON.stringify(reset.body)).toBe(200)
    const newPassword = reset.body.password as string
    expect(newPassword).not.toBe(oldPassword)

    const oldLogin = await api().post('/api/v1/auth/login').send({ student_id: 'reviewer1', password: oldPassword })
    expect(oldLogin.status).toBe(401)
    expect(oldLogin.body.code).toBe('INVALID_CREDENTIALS')

    const revoked = await api().post('/api/v1/auth/refresh').set('Cookie', cookieOf(device))
    expect(revoked.status).toBe(401)
    expect(revoked.body.code).toBe('TOKEN_INVALID')

    // 访问令牌还没过期，但签发时间早于改密时刻 —— 必须失效（§7.2）
    const stale = await authed(device.accessToken).get('/api/v1/users/me')
    expect(stale.status).toBe(401)
    expect(stale.body.code).toBe('TOKEN_INVALID')
    expect(stale.body.message).toContain('密码')

    const relogin = await login('reviewer1', newPassword)
    expect(relogin.userId).toBe(accountId)
  })

  it('已禁用的账号重置密码后仍是禁用状态', async () => {
    const account = await createUser({ studentId: 'reviewer1', name: '审核员甲', role: 'reviewer', status: 'disabled' })

    const reset = await authed(adminSession.accessToken).post(
      `/api/v1/admin/accounts/${account.id}/reset-password`,
    )
    expect(reset.status, JSON.stringify(reset.body)).toBe(200)
    expect(reset.body.account.status).toBe('disabled')
  })

  // -------------------------------------------------------------------------
  // 边界与契约
  // -------------------------------------------------------------------------

  it('参赛者账号不在本模块的管理范围内 → 404', async () => {
    const participant = await createUser({ studentId: '2026001', name: '张三' })

    const patch = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${participant.id}`)
      .send({ status: 'disabled' })
    expect(patch.status).toBe(404)
    expect(patch.body.code).toBe('NOT_FOUND')

    const reset = await authed(adminSession.accessToken).post(
      `/api/v1/admin/accounts/${participant.id}/reset-password`,
    )
    expect(reset.status).toBe(404)
  })

  it('四条写操作各留一条审计，且不含明文密码', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
    })
    const accountId = created.body.account.id as string
    const firstPassword = created.body.password as string

    await authed(adminSession.accessToken).patch(`/api/v1/admin/accounts/${accountId}`).send({ name: '审核员乙' })
    await authed(adminSession.accessToken).patch(`/api/v1/admin/accounts/${accountId}`).send({ status: 'disabled' })
    const reset = await authed(adminSession.accessToken).post(
      `/api/v1/admin/accounts/${accountId}/reset-password`,
    )
    const secondPassword = reset.body.password as string

    const logs = await db.auditLog.findMany({ where: { targetId: accountId } })
    expect(logs.map((log) => log.action).sort()).toEqual(
      ['account.create', 'account.password.reset', 'account.status.update', 'account.update'].sort(),
    )

    for (const log of logs) {
      expect(log.targetType).toBe('user')
      expect(log.actorId).toBe(adminId)
      expect(log.afterData ?? '').not.toContain(firstPassword)
      expect(log.afterData ?? '').not.toContain(secondPassword)
    }

    const statusLog = logs.find((log) => log.action === 'account.status.update')!
    expect(JSON.parse(statusLog.afterData!)).toMatchObject({ status: 'disabled', revoked_sessions: 0 })
  })

  it('敏感操作要求新鲜认证，且重放是安全的', async () => {
    const created = await createAccountAs(adminSession.accessToken, {
      student_id: 'reviewer1',
      name: '审核员甲',
      role: 'reviewer',
    })
    const accountId = created.body.account.id as string

    // 前移 6 分钟 —— 超过 requireFreshAuth 的 300 秒窗口
    freezeTimeAt(cst('2026-10-01T10:06:00'))

    const blocked = await authed(adminSession.accessToken)
      .patch(`/api/v1/admin/accounts/${accountId}`)
      .send({ name: '不该生效的改名' })
    expect(blocked.status).toBe(401)
    expect(blocked.body.code).toBe('REAUTH_REQUIRED')

    // 401 发生在守卫阶段，业务没有任何副作用 —— 所以重放同一个请求是安全的
    const untouched = await db.user.findUniqueOrThrow({ where: { id: accountId } })
    expect(untouched.name).toBe('审核员甲')

    const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', cookieOf(adminSession))
    expect(refreshed.status).toBe(200)

    const replay = await authed(refreshed.body.access_token as string)
      .patch(`/api/v1/admin/accounts/${accountId}`)
      .send({ name: '审核员乙' })
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect(replay.body.account.name).toBe('审核员乙')
  })

  it('空 body 与非法的角色取值被拒', async () => {
    const empty = await authed(adminSession.accessToken).patch(`/api/v1/admin/accounts/${adminId}`).send({})
    expect(empty.status).toBe(400)
    expect(empty.body.code).toBe('VALIDATION_FAILED')

    // participant 不属于本模块可管理的角色
    const badRole = await createAccountAs(adminSession.accessToken, {
      student_id: 'x1',
      name: '某人',
      role: 'participant',
    })
    expect(badRole.status).toBe(400)
  })
})
