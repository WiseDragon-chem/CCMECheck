import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, makeImage, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.3 参赛者可以分别完成三个赛道的当日打卡
 * design.md §16.4 同一赛道当日重新提交后只有最新版本进入审核队列
 */
describe('打卡提交', () => {
  const db = getPrismaClient()
  const ACTIVITY_DATE = '2026-10-01'

  let campaignId: string
  let participantId: string
  let token: string
  let jpeg: Buffer

  beforeEach(async () => {
    freezeTimeAt(cst(`${ACTIVITY_DATE}T10:00:00`))

    const { campaign } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    const session = await login('2026001', TEST_PASSWORD)
    token = session.accessToken

    jpeg = await makeImage('jpeg')
  })

  afterEach(() => {
    unfreezeTime()
  })

  it('三个赛道可以分别完成当日打卡', async () => {
    for (const track of ['reading', 'vocabulary', 'fitness']) {
      const response = await authed(token)
        .post('/api/v1/checkins')
        .field('track', track)
        .field('activity_date', ACTIVITY_DATE)
        .field('note', `${track} 打卡`)
        .attach('images', jpeg, 'proof.jpg')

      expect(response.status, JSON.stringify(response.body)).toBe(201)
      expect(response.body.track.slug).toBe(track)
      expect(response.body.status).toBe('pending')
      expect(response.body.asset_count).toBe(1)
    }

    const entries = await db.checkinEntry.findMany({ where: { participantId } })
    expect(entries).toHaveLength(3)
    expect(entries.every((entry) => entry.status === 'pending')).toBe(true)
    expect(entries.every((entry) => entry.activityDate === ACTIVITY_DATE)).toBe(true)
  })

  it('今日接口返回三张卡片且状态为待审核', async () => {
    await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    const response = await authed(token).get('/api/v1/checkins/today')
    expect(response.status).toBe(200)
    expect(response.body.is_participant).toBe(true)
    expect(response.body.activity_date).toBe(ACTIVITY_DATE)

    const cards = response.body.cards as Array<{ slug: string; card_state: string; can_submit: boolean }>
    expect(cards.map((card) => card.slug).sort()).toEqual(['fitness', 'reading', 'vocabulary'])

    const reading = cards.find((card) => card.slug === 'reading')!
    expect(reading.card_state).toBe('pending')
    // §7.3：待审核状态下截止前仍可重新提交
    expect(reading.can_submit).toBe(true)

    expect(cards.find((card) => card.slug === 'fitness')!.card_state).toBe('can_submit')
  })

  it('重新提交产生新版本，槽位不变，且只有最新版本进入审核队列', async () => {
    const first = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .field('note', '第一次提交')
      .attach('images', jpeg, 'proof.jpg')

    expect(first.status).toBe(201)
    expect(first.body.revision_number).toBe(1)

    const second = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .field('note', '重新提交')
      .attach('images', jpeg, 'proof-2.jpg')

    expect(second.status, JSON.stringify(second.body)).toBe(201)
    expect(second.body.revision_number).toBe(2)
    // §6.3：重新提交不会创建第二个有效槽位
    expect(second.body.entry_id).toBe(first.body.entry_id)

    const entries = await db.checkinEntry.findMany({ where: { participantId } })
    expect(entries).toHaveLength(1)

    const revisions = await db.submissionRevision.findMany({
      where: { entryId: entries[0]!.id },
      orderBy: { revisionNumber: 'asc' },
    })
    expect(revisions.map((revision) => revision.revisionNumber)).toEqual([1, 2])
    // 当前版本指向第 2 版
    expect(entries[0]!.currentRevisionId).toBe(revisions[1]!.id)
    expect(entries[0]!.status).toBe('pending')

    // 历史版本仍然保留（§3.3）
    const detail = await authed(token).get(`/api/v1/checkins/${first.body.entry_id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.current_revision.revision_number).toBe(2)
    expect(detail.body.history).toHaveLength(1)
    expect(detail.body.history[0].revision_number).toBe(1)
  })

  it('审核队列中同一槽位只出现一次', async () => {
    const admin = await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    void admin

    for (const note of ['一', '二', '三']) {
      await authed(token)
        .post('/api/v1/checkins')
        .field('track', 'reading')
        .field('activity_date', ACTIVITY_DATE)
        .field('note', note)
        .attach('images', jpeg, 'proof.jpg')
    }

    const reviewerSession = await login('reviewer1', TEST_PASSWORD)
    const queue = await authed(reviewerSession.accessToken).get('/api/v1/admin/reviews/queue')

    expect(queue.status, JSON.stringify(queue.body)).toBe(200)
    const entries = queue.body.entries ?? queue.body.items
    expect(entries).toHaveLength(1)
    expect(entries[0].revision_number).toBe(3)
  })

  it('同一 client_token 重复提交不会产生新版本（§7.4 防重复点击）', async () => {
    const clientToken = 'client-token-abcdefgh'

    const first = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .field('client_token', clientToken)
      .attach('images', jpeg, 'proof.jpg')

    expect(first.status).toBe(201)
    expect(first.body.idempotent_replay).toBe(false)

    const second = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .field('client_token', clientToken)
      .attach('images', jpeg, 'proof.jpg')

    expect(second.status).toBe(201)
    expect(second.body.idempotent_replay).toBe(true)
    expect(second.body.revision_number).toBe(1)
    expect(second.body.entry_id).toBe(first.body.entry_id)

    const count = await db.submissionRevision.count()
    expect(count).toBe(1)
  })

  it('拒绝无法解码的伪图片（§13 不接受仅改扩展名的伪装文件）', async () => {
    const { fakeJpeg } = await import('../helpers/factory.js')

    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', fakeJpeg(), 'fake.jpg')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('UPLOAD_INVALID')
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('未激活或非参赛者不能提交', async () => {
    const outsider = await createUser({ studentId: '2026999', name: '无关人员' })
    void outsider
    const outsiderSession = await login('2026999', TEST_PASSWORD)

    const response = await authed(outsiderSession.accessToken)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN')
  })

  it('未启用的赛道不允许提交', async () => {
    await db.campaignTrack.updateMany({
      where: { campaignId, track: { slug: 'fitness' } },
      data: { enabled: false },
    })

    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'fitness')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('TRACK_DISABLED')
  })

  it('活动不在打卡进行中时拒绝提交', async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'settling' } })

    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CAMPAIGN_NOT_ACTIVE')
  })

  it('未登录无法访问今日接口', async () => {
    const response = await api().get('/api/v1/checkins/today')
    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHENTICATED')
  })
})
