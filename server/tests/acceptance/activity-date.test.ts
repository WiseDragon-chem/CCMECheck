import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toActivityDate } from '../../src/core/time.js'
import { getPrismaClient } from '../../src/db/client.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, makeImage, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.10 活动日期边界和北京时间零点附近的记录归属正确。
 *
 * design.md §6.2 规定 activity_date 是「北京时间的那一天」，服务器只存 UTC。
 * 北京时间的零点对应 UTC 16:00，因此一条记录归到哪一天，完全取决于服务器时钟
 * 有没有跨过 16:00Z 这个边界 —— 与服务器自身的 TZ 设置无关。
 */
describe('§16.10 活动日期边界', () => {
  const db = getPrismaClient()
  /** 活动区间故意从 9-30 开始，好让「早于活动开始」的日期也有意义 */
  const START_DATE = '2026-09-30'

  let participantId: string
  let token: string
  let jpeg: Buffer

  beforeEach(async () => {
    const { campaign } = await bootstrapCampaign({ startDate: START_DATE, endDate: '2026-10-07' })

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId: campaign.id, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    token = (await login('2026001', TEST_PASSWORD)).accessToken
    jpeg = await makeImage('jpeg')
  })

  afterEach(() => {
    unfreezeTime()
  })

  function submit(activityDate: string, track = 'reading') {
    return authed(token)
      .post('/api/v1/checkins')
      .field('track', track)
      .field('activity_date', activityDate)
      .attach('images', jpeg, 'proof.jpg')
  }

  function today() {
    return authed(token).get('/api/v1/checkins/today')
  }

  // -------------------------------------------------------------------------
  // 归属规则本身
  // -------------------------------------------------------------------------

  it('UTC 16:00 是北京时间的日期切换点', () => {
    // 这两个瞬时相差一秒，却分属不同的活动日
    expect(toActivityDate(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09-30')
    expect(toActivityDate(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01')

    // 同一瞬间按 UTC 看还是 9-30，说明 activity_date 不是拿 UTC 日期截出来的
    expect(new Date('2026-09-30T16:00:00Z').toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  it('北京时间的一天可以横跨两个 UTC 日期', () => {
    // 北京时间每天 00:00 对应 UTC 前一天 16:00，全天都是这个偏移
    expect(toActivityDate(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01')
    expect(toActivityDate(new Date('2026-10-01T15:59:59Z'))).toBe('2026-10-01')
    expect(toActivityDate(new Date('2026-10-01T16:00:00Z'))).toBe('2026-10-02')
  })

  // -------------------------------------------------------------------------
  // 走完整 HTTP 链路：提交落在哪一天
  // -------------------------------------------------------------------------

  it('北京时间零点前的提交归属前一天', async () => {
    // 23:57 CST。假时钟会按真实时间缓慢漂移，所以不贴着 15:59:00Z 断言，
    // 留 2 分钟余量；精确到秒的边界由上面的纯函数用例负责
    freezeTimeAt(new Date('2026-09-30T15:57:00Z'))

    const response = await submit('2026-09-30')
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    expect(response.body.activity_date).toBe('2026-09-30')

    const entry = await db.checkinEntry.findFirstOrThrow({ where: { participantId } })
    expect(entry.activityDate).toBe('2026-09-30')
  })

  it('北京时间零点后的提交归属新的一天，前一天同时关闭', async () => {
    // 恰好是 2026-10-01 00:00 CST：新活动日的窗口刚刚打开
    freezeTimeAt(new Date('2026-09-30T16:00:00Z'))

    const fresh = await submit('2026-10-01')
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201)
    expect(fresh.body.activity_date).toBe('2026-10-01')

    // 同一时刻再想补交 9-30：那一天的截止（9-30 23:59 CST）已经过了
    const stale = await submit('2026-09-30')
    expect(stale.status, JSON.stringify(stale.body)).toBe(409)
    expect(stale.body.code).toBe('CHECKIN_CLOSED')

    const entries = await db.checkinEntry.findMany({ where: { participantId } })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.activityDate).toBe('2026-10-01')
  })

  it('今日接口按北京时间而非服务器本地时间判定', async () => {
    freezeTimeAt(new Date('2026-09-30T16:00:00Z'))

    const response = await today()
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.activity_date).toBe('2026-10-01')
    // 与 core/time 的换算结果一致
    expect(response.body.activity_date).toBe(toActivityDate(new Date()))
    // 此刻 UTC 仍是 9-30，若实现拿去截 UTC 日期会得到 2026-09-30
    expect(response.body.activity_date).not.toBe(new Date().toISOString().slice(0, 10))
  })

  it('跨月与跨年的今日归属正确', async () => {
    freezeTimeAt(new Date('2026-10-31T16:00:00Z'))
    expect((await today()).body.activity_date).toBe('2026-11-01')

    // 11 月是小月，顺带确认没有把「31 日」当成通用规律
    freezeTimeAt(new Date('2026-11-30T16:00:00Z'))
    expect((await today()).body.activity_date).toBe('2026-12-01')

    freezeTimeAt(new Date('2026-12-31T16:00:00Z'))
    expect((await today()).body.activity_date).toBe('2027-01-01')
  })

  // -------------------------------------------------------------------------
  // 不匹配任何开放窗口的日期
  // -------------------------------------------------------------------------

  it('早于活动区间的日期没有任何开放窗口，提交被拒', async () => {
    freezeTimeAt(cst('2026-10-05T10:00:00'))

    for (const date of ['2026-09-20', '2026-09-29']) {
      const response = await submit(date)
      expect(response.status, date).toBe(409)
      expect(response.body.code, date).toBe('CHECKIN_CLOSED')
    }

    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('晚于活动区间但早于今天的日期同样没有开放窗口', async () => {
    // 活动 10-07 结束，这里把时钟推到 10-20
    freezeTimeAt(cst('2026-10-20T10:00:00'))

    const response = await submit('2026-10-15')
    expect(response.status, JSON.stringify(response.body)).toBe(409)
    expect(response.body.code).toBe('CHECKIN_CLOSED')
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('未来日期仍然按「不能提交未来打卡」拒绝，而不是当成已截止', async () => {
    freezeTimeAt(cst('2026-10-05T10:00:00'))

    const response = await submit('2026-10-06')
    expect(response.status, JSON.stringify(response.body)).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })
})
