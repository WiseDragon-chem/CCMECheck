import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { authed, login } from '../helpers/app.js'
import {
  bootstrapCampaign,
  createEntry,
  createParticipant,
  createUser,
  makeImage,
  TEST_PASSWORD,
} from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * design.md §16.6 驳回原因能够正确显示给参赛者。
 * 同时覆盖 §8.2「驳回必须填写原因」与 §7.3 的卡片状态表。
 *
 * 驳回不是一个孤立的写操作：参赛者随后要在详情页、今日卡片上看到它，
 * 并且在截止前据此重新提交，截止后则不能再动 —— 因此这里走完整条链路。
 */
describe('§16.6 驳回原因显示给参赛者', () => {
  const db = getPrismaClient()
  const ACTIVITY_DATE = '2026-10-01'
  const DEADLINE = '23:00'

  let campaignId: string
  let participantId: string
  let readingTrackId: string
  let token: string
  let reviewerToken: string
  let jpeg: Buffer

  beforeEach(async () => {
    freezeTimeAt(cst(`${ACTIVITY_DATE}T10:00:00`))

    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      dailyDeadline: DEADLINE,
    })
    campaignId = campaign.id
    readingTrackId = tracks.find((track) => track.slug === 'reading')!.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId: campaign.id, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })

    token = (await login('2026001', TEST_PASSWORD)).accessToken
    reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken
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

  function reject(entryId: string, body: Record<string, unknown>) {
    return authed(reviewerToken).post(`/api/v1/admin/reviews/${entryId}/reject`).send(body)
  }

  function approve(entryId: string, version: number) {
    return authed(reviewerToken).post(`/api/v1/admin/reviews/${entryId}/approve`).send({ version })
  }

  interface TodayCard {
    slug: string
    card_state: string
    can_submit: boolean
    rejection_reason: string | null
    rejection_code: string | null
  }

  async function cardOf(slug: string): Promise<TodayCard> {
    const response = await authed(token).get('/api/v1/checkins/today')
    expect(response.status, JSON.stringify(response.body)).toBe(200)

    const card = (response.body.cards as TodayCard[]).find((item) => item.slug === slug)
    expect(card, `今日卡片里应有 ${slug} 赛道`).toBeDefined()
    return card!
  }

  // -------------------------------------------------------------------------
  // 驳回 → 参赛者可见
  // -------------------------------------------------------------------------

  it('驳回后参赛者在详情与今日卡片上都能看到原因', async () => {
    const created = await submitReading()
    const reason = '截图显示的是 9 月 30 日的记录'

    const rejected = await reject(created.entry_id, {
      version: created.version,
      reason_code: 'screenshot_date_mismatch',
      reason,
    })
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(rejected.body.status).toBe('rejected')
    expect(rejected.body.rejection_code).toBe('screenshot_date_mismatch')
    expect(rejected.body.rejection_reason).toBe(reason)

    const detail = await authed(token).get(`/api/v1/checkins/${created.entry_id}`)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)
    expect(detail.body.status).toBe('rejected')
    expect(detail.body.rejection_reason).toBe(reason)
    expect(detail.body.rejection_code).toBe('screenshot_date_mismatch')

    const card = await cardOf('reading')
    expect(card.card_state).toBe('rejected')
    expect(card.rejection_reason).toBe(reason)
    expect(card.rejection_code).toBe('screenshot_date_mismatch')
    // §7.3「已驳回且未截止」→ 可用操作是重新提交
    expect(card.can_submit).toBe(true)
  })

  it('只选预设原因时，用预设文案补齐成可读的驳回原因', async () => {
    const created = await submitReading()

    const rejected = await reject(created.entry_id, {
      version: created.version,
      reason_code: 'duplicate_image',
    })

    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(rejected.body.rejection_code).toBe('duplicate_image')
    // 结构化取值以 code 为准，展示文案由预设标签兜底
    expect(rejected.body.rejection_reason).toBe('图片重复')

    const detail = await authed(token).get(`/api/v1/checkins/${created.entry_id}`)
    expect(detail.body.rejection_reason).toBe('图片重复')
  })

  it('§7.3 截止后同一张卡片变为不可重新提交', async () => {
    const created = await submitReading()
    await reject(created.entry_id, {
      version: created.version,
      reason_code: 'content_unrecognizable',
      reason: '画面过暗，无法辨认打卡内容',
    })

    expect((await cardOf('reading')).can_submit).toBe(true)

    unfreezeTime()
    freezeTimeAt(cst(ACTIVITY_DATE, '23:30:00'))

    const card = await cardOf('reading')
    // 活动日没变，只是窗口关了
    expect(card.card_state).toBe('rejected')
    expect(card.can_submit).toBe(false)
    // 原因仍然可见 —— 截止只是不能再交，不是把结论抹掉
    expect(card.rejection_reason).toBe('画面过暗，无法辨认打卡内容')
  })

  // -------------------------------------------------------------------------
  // 驳回的必填约束
  // -------------------------------------------------------------------------

  it('§8.2 驳回必须填写原因', async () => {
    const created = await submitReading()

    // 完全不给 reason_code
    const missingCode = await reject(created.entry_id, { version: created.version, reason: '只写了说明' })
    expect(missingCode.status, JSON.stringify(missingCode.body)).toBe(400)
    expect(missingCode.body.code).toBe('VALIDATION_FAILED')

    // 选「其他」却不写具体原因
    const otherEmpty = await reject(created.entry_id, {
      version: created.version,
      reason_code: 'other',
      reason: '   ',
    })
    expect(otherEmpty.status, JSON.stringify(otherEmpty.body)).toBe(400)
    expect(otherEmpty.body.code).toBe('VALIDATION_FAILED')

    // 预设之外的原因码同样不合法
    const unknownCode = await reject(created.entry_id, {
      version: created.version,
      reason_code: '因为我不喜欢',
    })
    expect(unknownCode.status, JSON.stringify(unknownCode.body)).toBe(400)
    expect(unknownCode.body.code).toBe('VALIDATION_FAILED')

    // 校验失败不产生任何副作用
    const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: created.entry_id } })
    expect(entry.status).toBe('pending')
    expect(entry.rejectionCode).toBeNull()
    expect(entry.rejectionReason).toBeNull()
    expect(entry.reviewedAt).toBeNull()
    expect(await db.reviewAction.count({ where: { entryId: created.entry_id } })).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 驳回信息不残留
  // -------------------------------------------------------------------------

  it('重新提交后驳回原因消失，再次通过也看不到旧结论', async () => {
    const created = await submitReading()
    await reject(created.entry_id, {
      version: created.version,
      reason_code: 'insufficient_amount',
      reason: '运动时长不足 30 分钟',
    })

    const resubmitted = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof-2.jpg')

    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(201)
    // 重新提交回到同一个槽位，只是多了新版本
    expect(resubmitted.body.entry_id).toBe(created.entry_id)
    expect(resubmitted.body.revision_number).toBe(2)

    const afterResubmit = await authed(token).get(`/api/v1/checkins/${created.entry_id}`)
    expect(afterResubmit.body.status).toBe('pending')
    expect(afterResubmit.body.rejection_reason).toBeNull()
    expect(afterResubmit.body.rejection_code).toBeNull()

    const approved = await approve(created.entry_id, resubmitted.body.version as number)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.status).toBe('approved')
    expect(approved.body.rejection_reason).toBeNull()
    expect(approved.body.rejection_code).toBeNull()

    // 参赛者不该同时看到「已通过」和驳回原因（§7.3 卡片状态互斥）
    const detail = await authed(token).get(`/api/v1/checkins/${created.entry_id}`)
    expect(detail.body.status).toBe('approved')
    expect(detail.body.rejection_reason).toBeNull()
    expect(detail.body.rejection_code).toBeNull()

    const card = await cardOf('reading')
    expect(card.card_state).toBe('approved')
    expect(card.rejection_reason).toBeNull()
    expect(card.rejection_code).toBeNull()
  })

  it('审核通过本身会清除残留的驳回信息', async () => {
    // 直接摆一个「待审核但仍带着上一轮驳回信息」的状态：
    // approve 服务里显式清空了这两个字段，这里单独把它钉住 ——
    // 即便将来重新提交路径变了，也不该让参赛者同时看到「已通过」和驳回原因
    const { entry } = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate: ACTIVITY_DATE,
      withAsset: true,
    })
    await db.checkinEntry.update({
      where: { id: entry.id },
      data: { rejectionCode: 'other', rejectionReason: '上一轮的驳回说明' },
    })
    const stored = await db.checkinEntry.findUniqueOrThrow({ where: { id: entry.id } })

    const approved = await approve(entry.id, stored.version)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.status).toBe('approved')
    expect(approved.body.rejection_code).toBeNull()
    expect(approved.body.rejection_reason).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 审核详情
  // -------------------------------------------------------------------------

  it('审核详情接口返回记录、当前素材与历史', async () => {
    const created = await submitReading()
    await reject(created.entry_id, {
      version: created.version,
      reason_code: 'incomplete_proof',
      reason: '缺少运动记录截图',
    })

    const resubmitted = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof-2.jpg')
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(201)

    const detail = await authed(reviewerToken).get(`/api/v1/admin/reviews/${created.entry_id}`)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)

    expect(detail.body.entry_id).toBe(created.entry_id)
    expect(detail.body.status).toBe('pending')
    expect(detail.body.activity_date).toBe(ACTIVITY_DATE)
    expect(detail.body.is_resubmission).toBe(true)
    expect(detail.body.participant.student_id).toBe('2026001')
    expect(detail.body.participant.class_name).toBe('化学院一班')
    expect(detail.body.track.slug).toBe('reading')

    // 当前版本带着素材，审核页据此渲染中间的大图
    expect(detail.body.current_revision.revision_number).toBe(2)
    expect(detail.body.current_revision.assets).toHaveLength(1)
    expect(detail.body.current_revision.assets[0].asset_id).toBeTruthy()
    expect(detail.body.current_revision.assets[0].sort_order).toBe(0)

    // 历史：一次驳回，以及被折叠起来的第 1 版
    expect(detail.body.history.review_actions.map((action: { action: string }) => action.action)).toEqual(['reject'])
    expect(detail.body.history.review_actions[0].reason_code).toBe('incomplete_proof')
    expect(detail.body.history.review_actions[0].reason).toBe('缺少运动记录截图')
    expect(detail.body.history.review_actions[0].reviewer.name).toBe('审核员')
    expect(detail.body.history.previous_revisions.map((item: { revision_number: number }) => item.revision_number)).toEqual([1])
    expect(detail.body.history.previous_revisions[0].asset_count).toBe(1)
  })

  it('审核结束后的记录不能重复审核', async () => {
    const created = await submitReading()
    const rejected = await reject(created.entry_id, {
      version: created.version,
      reason_code: 'other',
      reason: '材料与赛道无关',
    })
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)

    // ① 拿着审核前的版本号再来一次：另一个人可能已经审过了
    const stale = await reject(created.entry_id, {
      version: created.version,
      reason_code: 'other',
      reason: '再驳一次',
    })
    expect(stale.status, JSON.stringify(stale.body)).toBe(409)
    expect(stale.body.code).toBe('REVIEW_CONFLICT')

    // ② 版本号对得上、但记录已经不在待审核：状态机不允许重复审核
    const repeat = await reject(created.entry_id, {
      version: rejected.body.version as number,
      reason_code: 'other',
      reason: '再驳一次',
    })
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(409)
    expect(repeat.body.code).toBe('STATE_TRANSITION_INVALID')
  })
})
