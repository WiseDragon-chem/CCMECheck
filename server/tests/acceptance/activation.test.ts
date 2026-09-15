import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, login } from '../helpers/app.js'
import {
  bootstrapCampaign,
  createActivationToken,
  createParticipant,
  createUser,
  TEST_PASSWORD,
} from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.1 名单中的学生可以激活账号，名单外的学号无法激活
 * design.md §16.2 同一学号无法重复创建账号
 * design.md §7.1 激活码只保存哈希，成功使用后立即失效
 *
 * 激活是「学号＋激活码」换密码的唯一入口，因此这里同时覆盖三条边界：
 * 名单外、激活码失效（用过 / 过期）、密码不达标。
 */
describe('账号激活', () => {
  const db = getPrismaClient()
  const ACCOUNT_PASSWORD = 'Activate123'
  const CODE = 'ACT-2026-0001'

  let campaignId: string

  beforeEach(async () => {
    freezeTimeAt(cst('2026-10-01T10:00:00'))
    const { campaign } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id
  })

  afterEach(() => {
    unfreezeTime()
  })

  /** 摆好一个「在名单里、尚未激活」的学生，返回账号与激活码记录 */
  async function rosterStudent(
    studentId: string,
    code: string,
    token: { expiresAt?: Date; usedAt?: Date | null } = {},
  ) {
    const user = await createUser({
      studentId,
      name: `学生${studentId}`,
      status: 'pending_activation',
      password: null,
    })
    await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
    const activation = await createActivationToken({ userId: user.id, code, ...token })
    return { user, activation }
  }

  function activate(body: { student_id: string; activation_code: string; password: string }) {
    return api().post('/api/v1/auth/activate').send(body)
  }

  it('名单中的学生用学号＋激活码完成激活并拿到令牌', async () => {
    const { user, activation } = await rosterStudent('2026001', CODE)

    const response = await activate({ student_id: '2026001', activation_code: CODE, password: ACCOUNT_PASSWORD })

    expect(response.status, JSON.stringify(response.body)).toBe(201)
    expect(response.body.user.status).toBe('active')
    expect(response.body.token_type).toBe('Bearer')
    expect(typeof response.body.access_token).toBe('string')

    // §7.2：刷新令牌只走 HttpOnly Cookie，响应体里绝不能出现明文
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? [])
    expect(cookies.some((cookie) => cookie.startsWith('ccme_refresh='))).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('refresh_token')

    const stored = await db.user.findUnique({ where: { id: user.id } })
    expect(stored!.status).toBe('active')
    expect(stored!.passwordHash).not.toBeNull()

    // §7.1：激活码一次性，成功使用后立即打上 usedAt；且库里只有哈希（§13）
    const used = await db.activationToken.findUnique({ where: { id: activation.id } })
    expect(used!.usedAt).not.toBeNull()
    expect(used!.tokenHash).not.toBe(CODE)

    // 激活后可以直接用新密码登录，无需管理员再次干预
    const session = await login('2026001', ACCOUNT_PASSWORD)
    expect(session.accessToken).toBeTruthy()
  })

  it('名单外的学号无法激活，也不会因此留下账号', async () => {
    const response = await activate({ student_id: '2026999', activation_code: CODE, password: ACCOUNT_PASSWORD })

    expect(response.status, JSON.stringify(response.body)).toBe(400)
    expect(response.body.code).toBe('ACTIVATION_INVALID')
    // §13：错误文案不透露学号是否存在于名单中，避免被用来枚举学号
    expect(response.body.message).not.toContain('不存在')
    expect(await db.user.count({ where: { studentId: '2026999' } })).toBe(0)
  })

  it('同一激活码不能使用两次', async () => {
    await rosterStudent('2026001', CODE)

    const first = await activate({ student_id: '2026001', activation_code: CODE, password: ACCOUNT_PASSWORD })
    expect(first.status, JSON.stringify(first.body)).toBe(201)

    const second = await activate({ student_id: '2026001', activation_code: CODE, password: ACCOUNT_PASSWORD })
    expect(second.status, JSON.stringify(second.body)).toBe(400)
    expect(second.body.code).toBe('ACTIVATION_INVALID')

    // 上面那次第二次尝试会先撞上「已有密码」分支，因此单独构造一条 usedAt 已写入、
    // 但账号仍未激活的记录，才能真正验证 usedAt 这条判定
    await rosterStudent('2026002', 'ACT-2026-0002', { usedAt: new Date() })
    const reused = await activate({ student_id: '2026002', activation_code: 'ACT-2026-0002', password: ACCOUNT_PASSWORD })
    expect(reused.status, JSON.stringify(reused.body)).toBe(400)
    expect(reused.body.code).toBe('ACTIVATION_INVALID')

    const stillPending = await db.user.findUnique({ where: { studentId: '2026002' } })
    expect(stillPending!.status).toBe('pending_activation')
    expect(stillPending!.passwordHash).toBeNull()
  })

  it('过期的激活码被拒绝', async () => {
    await rosterStudent('2026003', 'ACT-2026-0003', { expiresAt: cst('2026-09-01T00:00:00') })

    const response = await activate({
      student_id: '2026003',
      activation_code: 'ACT-2026-0003',
      password: ACCOUNT_PASSWORD,
    })

    expect(response.status, JSON.stringify(response.body)).toBe(400)
    expect(response.body.code).toBe('ACTIVATION_INVALID')

    const user = await db.user.findUnique({ where: { studentId: '2026003' } })
    expect(user!.status).toBe('pending_activation')
    expect(user!.passwordHash).toBeNull()
  })

  it('§16.2 同一学号无法重复创建账号', async () => {
    await rosterStudent('2026004', 'ACT-2026-0004')
    const created = await activate({ student_id: '2026004', activation_code: 'ACT-2026-0004', password: ACCOUNT_PASSWORD })
    expect(created.status, JSON.stringify(created.body)).toBe(201)

    // 第二次激活必然失败，且失败的方式是「拒绝」而不是「再建一个账号」
    const again = await activate({ student_id: '2026004', activation_code: 'ACT-2026-0004', password: ACCOUNT_PASSWORD })
    expect(again.status, JSON.stringify(again.body)).toBe(400)
    expect(again.body.code).toBe('ACTIVATION_INVALID')

    expect(await db.user.count({ where: { studentId: '2026004' } })).toBe(1)
  })

  it('密码策略不达标时返回字段级校验错误，且不消耗激活码', async () => {
    const { activation } = await rosterStudent('2026005', 'ACT-2026-0005')

    const tooShort = await activate({ student_id: '2026005', activation_code: 'ACT-2026-0005', password: 'Ab1' })
    expect(tooShort.status, JSON.stringify(tooShort.body)).toBe(400)
    expect(tooShort.body.code).toBe('VALIDATION_FAILED')
    // §12.5：校验失败必须给出可定位到字段的明细，前端据此把错误挂到输入框上
    const fields = tooShort.body.details.fields as Array<{ field: string; message: string }>
    expect(Array.isArray(fields)).toBe(true)
    expect(fields.map((item) => item.field)).toContain('password')

    const noDigit = await activate({ student_id: '2026005', activation_code: 'ACT-2026-0005', password: 'abcdefgh' })
    expect(noDigit.status, JSON.stringify(noDigit.body)).toBe(400)
    expect(noDigit.body.code).toBe('VALIDATION_FAILED')
    expect((noDigit.body.details.fields as Array<{ field: string }>).map((item) => item.field)).toContain('password')

    // 校验发生在业务逻辑之前：激活码不能被一次失败的尝试吃掉
    const fresh = await db.activationToken.findUnique({ where: { id: activation.id } })
    expect(fresh!.usedAt).toBeNull()
    const user = await db.user.findUnique({ where: { studentId: '2026005' } })
    expect(user!.passwordHash).toBeNull()
  })

  it('§7.2 连续失败的激活尝试会触发限流', async () => {
    // 限流器开了 skipSuccessfulRequests，只统计失败请求，所以这里全部用错误的激活码
    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await activate({
        student_id: '2026888',
        activation_code: `WRONG-CODE-${attempt}`,
        password: ACCOUNT_PASSWORD,
      })
      statuses.push(response.status)
      if (response.status === 429) {
        expect(response.body.code).toBe('RATE_LIMITED')
      }
    }

    expect(statuses.filter((status) => status === 400).length).toBeGreaterThan(0)
    expect(statuses).toContain(429)

    // 一旦触发限流，同 IP＋学号的后续请求应全部被挡住，而不是间歇性放行
    const firstLimited = statuses.indexOf(429)
    expect(statuses.slice(firstLimited).every((status) => status === 429)).toBe(true)
  })

  it('未登录的登录接口不泄漏账号是否存在', async () => {
    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ student_id: '2026001', password: 'WrongPassword1' })
    const noSuchUser = await api()
      .post('/api/v1/auth/login')
      .send({ student_id: '2026977', password: 'WrongPassword1' })

    expect(wrongPassword.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS')
    expect(noSuchUser.body.code).toBe(wrongPassword.body.code)
    expect(noSuchUser.body.message).toBe(wrongPassword.body.message)
  })

  it('未激活的账号不能直接登录', async () => {
    await rosterStudent('2026006', 'ACT-2026-0006')

    const response = await api().post('/api/v1/auth/login').send({ student_id: '2026006', password: TEST_PASSWORD })

    expect(response.status, JSON.stringify(response.body)).toBe(401)
    expect(response.body.code).toBe('ACCOUNT_NOT_ACTIVATED')
  })
})
