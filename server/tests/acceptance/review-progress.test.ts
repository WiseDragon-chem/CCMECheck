import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, makeImage, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * §8.2 审核进度统计的是「今天做了多少次审核决定」，不是「此刻有多少条记录
 * 处于通过/驳回状态」。
 *
 * 这条区别只在重新提交时显形：被驳回的记录一经重新提交就被推回 pending，
 * 记录上的驳回痕迹同时被清空。若按当前状态统计，审核员今天做过的驳回会
 * 在参赛者重新提交的那一刻消失，最终只留下一句「通过 1 次」。
 */
describe('§8.2 审核进度按审核决定统计', () => {
  const ACTIVITY_DATE = '2026-10-01'

  let token: string
  let reviewerToken: string
  let adminToken: string
  let jpeg: Buffer

  beforeEach(async () => {
    freezeTimeAt(cst(`${ACTIVITY_DATE}T10:00:00`))

    const { campaign } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      dailyDeadline: '23:00',
    })
    const user = await createUser({ studentId: '2026001', name: '张三' })
    await createParticipant({ campaignId: campaign.id, userId: user.id, className: '化学院一班' })
    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })

    token = (await login('2026001', TEST_PASSWORD)).accessToken
    reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
    jpeg = await makeImage('jpeg')
  })

  afterEach(() => {
    unfreezeTime()
  })

  interface SubmitResult {
    entry_id: string
    version: number
    revision_number: number
  }

  async function submitReading(): Promise<SubmitResult> {
    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body as SubmitResult
  }

  function reject(entryId: string, version: number, reason: string) {
    return authed(reviewerToken)
      .post(`/api/v1/admin/reviews/${entryId}/reject`)
      .send({ version, reason_code: 'other', reason })
  }

  function approve(entryId: string, version: number) {
    return authed(reviewerToken).post(`/api/v1/admin/reviews/${entryId}/approve`).send({ version })
  }

  interface Progress {
    pending_total: number
    reviewed_today: number
    approved_today: number
    rejected_today: number
  }

  async function progress(): Promise<Progress> {
    const response = await authed(reviewerToken).get('/api/v1/admin/reviews/queue')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body.progress as Progress
  }

  it('驳回 → 重新提交 → 通过，算 1 次驳回 + 1 次通过', async () => {
    const created = await submitReading()

    const rejected = await reject(created.entry_id, created.version, '截图与赛道无关')
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(await progress()).toEqual({
      pending_total: 0,
      reviewed_today: 1,
      approved_today: 0,
      rejected_today: 1,
    })

    // 重新提交把记录推回 pending，记录上不再有驳回的痕迹 ——
    // 但今天已经做出过的那次驳回不能被抹掉
    const resubmitted = await submitReading()
    expect(resubmitted.entry_id).toBe(created.entry_id)
    expect(resubmitted.revision_number).toBe(2)
    expect(await progress()).toEqual({
      pending_total: 1,
      reviewed_today: 1,
      approved_today: 0,
      rejected_today: 1,
    })

    const approved = await approve(created.entry_id, resubmitted.version)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)

    expect(await progress()).toEqual({
      pending_total: 0,
      reviewed_today: 2,
      approved_today: 1,
      rejected_today: 1,
    })
  })

  it('同一记录被反复驳回再重新提交，每一次都单独计入', async () => {
    const created = await submitReading()
    await reject(created.entry_id, created.version, '第一次不合格')

    const second = await submitReading()
    await reject(created.entry_id, second.version, '第二次仍不合格')

    expect(await progress()).toEqual({
      pending_total: 0,
      reviewed_today: 2,
      approved_today: 0,
      rejected_today: 2,
    })
  })

  it('通过后再被撤销，那次通过仍然计入今日决定', async () => {
    /*
      撤销是超管对记录现状的处置，不是把审核员的那一刻抹掉：进度衡量的是
      「今天干了多少活」。状态与进度在这里刻意不同口径 —— 参赛者能否计分
      看状态（撤销后不再计分），审核员的工作量看决定。
    */
    const created = await submitReading()
    const approved = await approve(created.entry_id, created.version)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)

    const revoked = await authed(adminToken)
      .post(`/api/v1/admin/checkins/${created.entry_id}/revoke`)
      .send({ version: approved.body.version, reason: '申诉成立，撤回通过结论' })
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200)

    expect(await progress()).toMatchObject({ reviewed_today: 1, approved_today: 1, rejected_today: 0 })
  })
})
