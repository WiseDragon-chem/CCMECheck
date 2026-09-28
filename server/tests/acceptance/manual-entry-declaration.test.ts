import { beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { loadScoringInputs, computeParticipantScore } from '../../src/services/scoring.service.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'

/**
 * 补录的申报明细（design.md §9.1、§8.5）。
 *
 * 补录走的是独立接口，不经打卡表单，所以它与参赛者提交是不是**同一套规则**
 * 得单独验：两条路径如果分叉，同一条 60 分钟运动自己交记 2 分、补录记 1 分，
 * 而且补录记录没有后续编辑入口（唯一的修改路径是重开 + 参赛者重交，
 * 对补录而言荒谬），错了就永远是错的。
 *
 * 分值断言走 loadScoringInputs —— 快照与 CSV 导出用的就是它，
 * 因此这里顺带验到了「补录的明细确实被计分读到了」。
 */

describe('§9.1 补录的申报明细与分值', () => {
  const db = getPrismaClient()

  const ACTIVITY_DATE = '2026-10-03'
  let campaignId: string
  let participantId: string
  let trackIds: Record<string, string>
  let adminToken: string

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id
    trackIds = Object.fromEntries(tracks.map((track) => [track.slug, track.id]))

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
  })

  function backfill(slug: string, extra: Record<string, unknown> = {}) {
    return authed(adminToken)
      .post('/api/v1/admin/checkins/manual')
      .send({
        participant_id: participantId,
        track_id: slug,
        activity_date: ACTIVITY_DATE,
        reason: '学生因网络故障未能按时提交，材料已线下核实',
        status: 'approved',
        ...extra,
      })
  }

  /** 该参与者的赛道积分（毫点）。走的正是快照与导出用的那条读路径 */
  async function trackScore(slug: string): Promise<number> {
    const inputs = await loadScoringInputs(campaignId, ACTIVITY_DATE)
    const scored = computeParticipantScore({
      participantId,
      configs: inputs.configs.filter((config) => config.slug === slug),
      input: inputs.byParticipant.get(participantId)!,
    })

    return scored.tracks.get(slug)?.score ?? 0
  }

  it('单词赛道补录缺少数量时拒绝', async () => {
    const response = await backfill('vocabulary')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('运动赛道补录缺少运动类型时拒绝', async () => {
    const response = await backfill('fitness')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('读书赛道没有材料但有备注，补录一样放行', async () => {
    // 补录一定会写一版备注（「管理员补录：<原因>」），所以读书的
    // 「图片与备注有一个即可」在这里由备注满足
    const response = await backfill('reading')

    expect(response.status, JSON.stringify(response.body)).toBe(201)
    expect(await trackScore('reading')).toBe(1000)
  })

  it('补录的单词数量按档计分，且与自己提交的结果一致', async () => {
    await backfill('vocabulary', { word_count: 35 })
    expect(await trackScore('vocabulary')).toBe(1000)

    // 换一天补录一条二档，确认低档那条没有被改写
    await db.checkinEntry.updateMany({ data: { activityDate: '2026-10-02' } })
    await authed(adminToken)
      .post('/api/v1/admin/checkins/manual')
      .send({
        participant_id: participantId,
        track_id: 'vocabulary',
        activity_date: ACTIVITY_DATE,
        reason: '补录二档',
        status: 'approved',
        word_count: 60,
      })

    expect(await trackScore('vocabulary')).toBe(3000)
  })

  it('补录的运动类型按档计分', async () => {
    await backfill('fitness', { exercise_type: 'workout_60min' })

    // 60 分钟是二档 —— 这条断言就是「补录与自己交同规则」的守门人
    expect(await trackScore('fitness')).toBe(2000)
  })
})
