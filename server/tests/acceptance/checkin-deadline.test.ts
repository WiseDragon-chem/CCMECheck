import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, makeImage, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.5 截止时间到达后，普通用户无法提交或重新提交。
 *
 * 这里同时覆盖 §8.5 的「临时重新开放」：重开必须有时限，
 * 否则它就是一条永久绕过节流校验的后门。
 */
describe('打卡截止时间', () => {
  const db = getPrismaClient()
  const ACTIVITY_DATE = '2026-10-01'
  const DEADLINE = '23:00'

  let campaignId: string
  let participantId: string
  let token: string
  let adminToken: string
  let jpeg: Buffer

  beforeEach(async () => {
    const { campaign } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      dailyDeadline: DEADLINE,
    })
    campaignId = campaign.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: user.id })
    participantId = participant.id

    await createUser({ studentId: 'admin1', name: '管理员', role: 'super_admin' })

    token = (await login('2026001', TEST_PASSWORD)).accessToken
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken

    jpeg = await makeImage('jpeg')
  })

  afterEach(() => {
    unfreezeTime()
  })

  function submit(track = 'reading') {
    return authed(token)
      .post('/api/v1/checkins')
      .field('track', track)
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')
  }

  it('截止前可以提交', async () => {
    // 留出一分钟余量：假时钟会按真实时间缓慢漂移，贴着截止点断言会变得不稳定
    freezeTimeAt(cst(ACTIVITY_DATE, '22:59:00'))

    const response = await submit()
    expect(response.status, JSON.stringify(response.body)).toBe(201)
  })

  it('截止瞬间仍可提交，过一秒即被拒绝', async () => {
    freezeTimeAt(cst(ACTIVITY_DATE, '23:00:00'))
    expect((await submit()).status).toBe(201)

    unfreezeTime()
    freezeTimeAt(cst(ACTIVITY_DATE, '23:00:01'))
    // 已有记录，走的是重新提交路径，同样必须被拦住
    const late = await submit()
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('CHECKIN_CLOSED')
  })

  it('截止后未提交过的用户无法提交', async () => {
    freezeTimeAt(cst(ACTIVITY_DATE, '23:30:00'))

    const response = await submit()
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CHECKIN_CLOSED')
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('已驳回的记录在截止后也不能重新提交', async () => {
    freezeTimeAt(cst(ACTIVITY_DATE, '20:00:00'))
    const created = await submit()
    expect(created.status).toBe(201)

    await db.checkinEntry.update({
      where: { id: created.body.entry_id as string },
      data: { status: 'rejected', rejectionReason: '截图日期不符合' },
    })

    unfreezeTime()
    freezeTimeAt(cst(ACTIVITY_DATE, '23:30:00'))

    const response = await submit()
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CHECKIN_CLOSED')
  })

  it('活动日尚未开放时不能提前提交', async () => {
    // 活动配置为 00:00 开放，这里改到 06:00 再试
    await db.campaign.update({ where: { id: campaignId }, data: { dailyOpenTime: '06:00' } })
    freezeTimeAt(cst(ACTIVITY_DATE, '05:00:00'))

    const response = await submit()
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CHECKIN_NOT_OPEN')
  })

  it('不能提交未来日期的打卡', async () => {
    freezeTimeAt(cst(ACTIVITY_DATE, '10:00:00'))

    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', '2026-10-05')
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })

  describe('管理员临时重新开放（§8.5）', () => {
    it('重开后在时限内可以重新提交，期限一过重新关闭', async () => {
      // 先造一条截止前提交的记录
      freezeTimeAt(cst(ACTIVITY_DATE, '20:00:00'))
      const created = await submit()
      const entryId = created.body.entry_id as string

      // 把时钟推到截止之后
      unfreezeTime()
      freezeTimeAt(cst(ACTIVITY_DATE, '23:30:00'))
      expect((await submit()).status).toBe(409)

      const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })

      // 重开 30 分钟
      const reopened = await authed(adminToken)
        .post(`/api/v1/admin/checkins/${entryId}/reopen`)
        .send({ version: entry.version, reason: '学生反馈截图时间有误，核实后允许重交', reopen_minutes: 30 })
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200)

      // 时限内放行
      const afterReopen = await submit()
      expect(afterReopen.status, JSON.stringify(afterReopen.body)).toBe(201)

      // 成功提交会消费掉重开窗口，避免它长期有效
      const afterResubmit = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })
      expect(afterResubmit.reopenExpiresAt).toBeNull()

      // 再次重开，然后把时钟推过期限（23:30 重开 30 分钟 → 00:00 失效）
      const reopenedAgain = await authed(adminToken)
        .post(`/api/v1/admin/checkins/${entryId}/reopen`)
        .send({ version: afterResubmit.version, reason: '再次核实', reopen_minutes: 30 })
      expect(reopenedAgain.status).toBe(200)

      unfreezeTime()
      freezeTimeAt(cst('2026-10-02', '00:30:00'))

      const expired = await submit()
      expect(expired.status).toBe(409)
      expect(expired.body.code).toBe('CHECKIN_CLOSED')
    })

    it('重开必须填写原因', async () => {
      freezeTimeAt(cst(ACTIVITY_DATE, '20:00:00'))
      const created = await submit()
      const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: created.body.entry_id as string } })

      const response = await authed(adminToken)
        .post(`/api/v1/admin/checkins/${created.body.entry_id as string}/reopen`)
        .send({ version: entry.version, reason: '' })

      expect(response.status).toBe(400)
      expect(response.body.code).toBe('VALIDATION_FAILED')
    })

    it('审核员无权重新开放', async () => {
      await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
      const reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken

      freezeTimeAt(cst(ACTIVITY_DATE, '20:00:00'))
      const created = await submit()
      const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: created.body.entry_id as string } })

      const response = await authed(reviewerToken)
        .post(`/api/v1/admin/checkins/${created.body.entry_id as string}/reopen`)
        .send({ version: entry.version, reason: '试图越权' })

      expect(response.status).toBe(403)
    })
  })
})
