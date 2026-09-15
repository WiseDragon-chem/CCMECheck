import { beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { api, authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst } from '../helpers/time.js'

/**
 * design.md §16.14 管理员补录、撤销和积分调整均产生审计记录。
 * design.md §8.5 列出全部异常操作，并要求「所有异常操作必须填写原因，并写入审计日志」。
 *
 * 审计的价值在于「事后能还原是谁、什么时候、依据什么改了哪条记录」，
 * 因此每条用例都断言四件事：动作名、操作人、原因、以及本次请求的 request_id。
 * request_id 用请求头固定下来 —— 它能对上，才说明审计确实绑定在这次请求上，
 * 而不是某处凭空写的一行。
 *
 * 这里刻意不冻结时钟：审计行的时间戳由数据库按真实时间生成，
 * 「最新一条在最前」的断言依赖毫秒级先后，用假时钟反而会把这层验证搞糊。
 */

interface AuditPayload {
  [key: string]: unknown
}

describe('§16.14 管理员操作均产生审计记录', () => {
  const db = getPrismaClient()

  let campaignId: string
  let participantId: string
  let readingTrackId: string
  let adminId: string
  let adminToken: string
  let reviewerToken: string
  let participantToken: string

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    campaignId = campaign.id
    readingTrackId = tracks.find((track) => track.slug === 'reading')!.id

    const user = await createUser({ studentId: '2026001', name: '张三' })
    const participant = await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
    participantId = participant.id

    const admin = await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminId = admin.id
    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })

    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
    reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken
    participantToken = (await login('2026001', TEST_PASSWORD)).accessToken
  })

  /** 带上 request_id 发管理员请求：审计行里的 request_id 必须与它一致 */
  function adminPost(path: string, body: Record<string, unknown>, requestId: string) {
    return authed(adminToken).post(path).set('X-Request-Id', requestId).send(body)
  }

  interface AuditRow {
    row: {
      action: string
      actorId: string | null
      targetType: string | null
      targetId: string | null
      requestId: string | null
      beforeData: string | null
      afterData: string | null
    }
    before: AuditPayload | null
    after: AuditPayload | null
  }

  /** 取某个动作的审计行，并顺带断言「恰好一条」 */
  async function auditRowFor(action: string): Promise<AuditRow> {
    const rows = await db.auditLog.findMany({ where: { action } })
    expect(rows, `动作 ${action} 应恰好产生一条审计记录`).toHaveLength(1)

    const row = rows[0]!
    return {
      row,
      before: row.beforeData ? (JSON.parse(row.beforeData) as AuditPayload) : null,
      after: row.afterData ? (JSON.parse(row.afterData) as AuditPayload) : null,
    }
  }

  /** 已通过的记录：撤销只能从 approved 发起 */
  async function approvedEntry(activityDate = '2026-10-01') {
    const created = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate,
      status: 'approved',
      reviewedAt: cst('2026-10-01T09:00:00'),
      reviewedBy: adminId,
    })
    return created.entry
  }

  // -------------------------------------------------------------------------
  // §8.5 的五个异常操作
  // -------------------------------------------------------------------------

  it('§8.5 临时重新开放：审计含前后状态、时长与原因', async () => {
    const entry = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate: '2026-10-01',
    })
    const reason = '学生反馈截图时间有误，核实后允许重新提交'

    const response = await adminPost(
      `/api/v1/admin/checkins/${entry.entry.id}/reopen`,
      { version: entry.entry.version, reason, reopen_minutes: 60 },
      'req_audit_reopen_0001',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)

    const { row, before, after } = await auditRowFor('checkin.reopen')
    expect(row.actorId).toBe(adminId)
    expect(row.targetType).toBe('checkin_entry')
    expect(row.targetId).toBe(entry.entry.id)
    expect(row.requestId).toBe('req_audit_reopen_0001')

    expect(before).toMatchObject({ status: 'pending', version: entry.entry.version })
    expect(after).toMatchObject({
      status: 'pending',
      version: entry.entry.version + 1,
      reopen_minutes: 60,
      reason,
    })
    expect(after!.reason).toBe(reason)

    // review_actions 是审核过程的留痕，同样要带上原因
    const action = await db.reviewAction.findFirstOrThrow({ where: { entryId: entry.entry.id, action: 'reopen' } })
    expect(action.reason).toBe(reason)
    expect(action.reviewerId).toBe(adminId)
  })

  it('§8.5 撤销审核结果：审计含 approved → revoked 的前后状态', async () => {
    const entry = await approvedEntry()
    const reason = '复核发现证明材料与本人不符'

    const response = await adminPost(
      `/api/v1/admin/checkins/${entry.id}/revoke`,
      { version: entry.version, reason },
      'req_audit_revoke_0001',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.status).toBe('revoked')

    const { row, before, after } = await auditRowFor('review.revoke')
    expect(row.actorId).toBe(adminId)
    expect(row.targetType).toBe('checkin_entry')
    expect(row.targetId).toBe(entry.id)
    expect(row.requestId).toBe('req_audit_revoke_0001')

    expect(before).toMatchObject({ status: 'approved', version: entry.version })
    expect(after).toMatchObject({ status: 'revoked', version: entry.version + 1, reason })
    expect(after!.reason).toBe(reason)
  })

  it('§8.5 作废违规记录：审计含前后状态与原因', async () => {
    const entry = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate: '2026-10-02',
    })
    const reason = '该记录为重复提交，作废处理'

    const response = await adminPost(
      `/api/v1/admin/checkins/${entry.entry.id}/void`,
      { version: entry.entry.version, reason },
      'req_audit_void_0001',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.status).toBe('void')

    const { row, before, after } = await auditRowFor('review.void')
    expect(row.actorId).toBe(adminId)
    expect(row.targetId).toBe(entry.entry.id)
    expect(row.requestId).toBe('req_audit_void_0001')

    expect(before).toMatchObject({ status: 'pending' })
    expect(after).toMatchObject({ status: 'void', reason })
    expect(after!.reason).toBe(reason)
  })

  it('§8.5 管理员补录：审计记录「从无到有」与补录后的内容', async () => {
    const reason = '学生因网络故障未能按时提交，材料已线下核实'
    const note = '教务处提供的截图'

    const response = await adminPost(
      '/api/v1/admin/checkins/manual',
      {
        participant_id: participantId,
        track_id: 'reading',
        activity_date: '2026-10-03',
        reason,
        note,
        status: 'pending',
      },
      'req_audit_manual_0001',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(201)

    const { row, before, after } = await auditRowFor('checkin.manual_create')
    expect(row.actorId).toBe(adminId)
    expect(row.targetType).toBe('checkin_entry')
    expect(row.targetId).toBe(response.body.entry_id)
    expect(row.requestId).toBe('req_audit_manual_0001')

    // 补录之前不存在这条记录，因此没有前值
    expect(before).toBeNull()
    expect(after).toMatchObject({
      status: 'pending',
      participant_id: participantId,
      student_id: '2026001',
      track_slug: 'reading',
      activity_date: '2026-10-03',
      revision_id: response.body.revision_id,
      reason,
    })
    expect(after!.reason).toBe(reason)

    // 补录本身也是审核动作，写进 review_actions
    const action = await db.reviewAction.findFirstOrThrow({ where: { entryId: response.body.entry_id as string } })
    expect(action.action).toBe('manual_create')
    expect(action.reason).toBe(reason)
  })

  it('§9.1 积分调整只新增调整记录，绝不改动原始积分字段', async () => {
    const entry = await approvedEntry()
    const entryBefore = await db.checkinEntry.findUniqueOrThrow({ where: { id: entry.id } })
    const trackBefore = await db.campaignTrack.findFirstOrThrow({ where: { campaignId, trackId: readingTrackId } })
    const reason = '校级活动获奖，额外加分'

    const response = await adminPost(
      '/api/v1/admin/score-adjustments',
      { participant_id: participantId, track_id: 'reading', points_delta: 500, reason },
      'req_audit_score_0001',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(201)

    // 调整单独成行，带上调整值、原因、操作人
    const adjustments = await db.scoreAdjustment.findMany({ where: { participantId } })
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({
      campaignId,
      participantId,
      trackId: 'reading',
      pointsDelta: 500,
      reason,
      operatorId: adminId,
    })

    // §9.1 的核心：人工调整不得直接修改原始积分字段。
    // 打卡记录整行逐字段未变（含 version / reviewedAt / updatedAt）。
    const entryAfter = await db.checkinEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(entryAfter).toEqual(entryBefore)

    // 赛道的计分配置同样不该被这次调整碰到
    const trackAfter = await db.campaignTrack.findFirstOrThrow({ where: { campaignId, trackId: readingTrackId } })
    expect(trackAfter).toEqual(trackBefore)

    const { row, before, after } = await auditRowFor('score.adjust')
    expect(row.actorId).toBe(adminId)
    expect(row.targetType).toBe('score_adjustment')
    expect(row.targetId).toBe(response.body.adjustment_id)
    expect(row.requestId).toBe('req_audit_score_0001')

    // 调整记录是新增的，没有前值
    expect(before).toBeNull()
    expect(after).toMatchObject({
      campaign_id: campaignId,
      participant_id: participantId,
      track_id: 'reading',
      points_delta: 500,
      reason,
    })
    expect(after!.reason).toBe(reason)
  })

  it('积分调整支持总榜哨兵值（§11.2）', async () => {
    const response = await adminPost(
      '/api/v1/admin/score-adjustments',
      { participant_id: participantId, track_id: '__overall__', points_delta: -200, reason: '扣除重复计入的分数' },
      'req_audit_score_overall',
    )
    expect(response.status, JSON.stringify(response.body)).toBe(201)

    const adjustment = await db.scoreAdjustment.findFirstOrThrow({ where: { participantId } })
    expect(adjustment.trackId).toBe('__overall__')
    expect(adjustment.pointsDelta).toBe(-200)

    const { after } = await auditRowFor('score.adjust')
    expect(after).toMatchObject({ track_id: '__overall__', points_delta: -200 })
  })

  // -------------------------------------------------------------------------
  // 只读查询
  // -------------------------------------------------------------------------

  /** 依次跑完 §8.5 的全部写操作，返回它们各自的 request_id */
  async function runEveryOperation(): Promise<string[]> {
    // 同一参赛者同一赛道同一活动日只能有一条记录，五个操作各占一个活动日
    const reopenTarget = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate: '2026-10-01',
    })
    const revokeTarget = await approvedEntry('2026-10-03')
    const voidTarget = await createEntry({
      campaignId,
      participantId,
      trackId: readingTrackId,
      activityDate: '2026-10-02',
    })

    const calls = [
      () =>
        adminPost(
          `/api/v1/admin/checkins/${reopenTarget.entry.id}/reopen`,
          { version: reopenTarget.entry.version, reason: '重新开放以便重新提交材料' },
          'req_list_reopen',
        ),
      () =>
        adminPost(
          `/api/v1/admin/checkins/${revokeTarget.id}/revoke`,
          { version: revokeTarget.version, reason: '材料复核不通过' },
          'req_list_revoke',
        ),
      () =>
        adminPost(
          `/api/v1/admin/checkins/${voidTarget.entry.id}/void`,
          { version: voidTarget.entry.version, reason: '重复提交的记录' },
          'req_list_void',
        ),
      () =>
        adminPost(
          '/api/v1/admin/checkins/manual',
          {
            participant_id: participantId,
            track_id: 'reading',
            activity_date: '2026-10-04',
            reason: '线下核实后补录',
          },
          'req_list_manual',
        ),
      () =>
        adminPost(
          '/api/v1/admin/score-adjustments',
          { participant_id: participantId, track_id: 'reading', points_delta: 1000, reason: '补录对应的积分' },
          'req_list_score',
        ),
    ]

    const requestIds: string[] = []
    for (const call of calls) {
      const response = await call()
      expect(response.status, JSON.stringify(response.body)).toBeLessThan(300)
      // requestContext 会把本次请求的 id 回写到响应头，用它对照审计行
      requestIds.push(response.headers['x-request-id'] as string)

      // 让相邻两次操作的时间戳拉开到毫秒级之外，避免「最新在最前」出现并列
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return requestIds
  }

  it('超管读取审计日志：字段齐全且最新一条在最前', async () => {
    const requestIds = await runEveryOperation()

    const response = await authed(adminToken).get('/api/v1/admin/audit-logs')
    expect(response.status, JSON.stringify(response.body)).toBe(200)

    interface Item {
      id: string
      actor: { id: string; student_id: string; name: string; role: string } | null
      action: string
      target_type: string | null
      target_id: string | null
      before: AuditPayload | null
      after: AuditPayload | null
      request_id: string | null
      created_at: string
    }

    const items = response.body.items as Item[]
    expect(response.body.total).toBe(5)
    expect(items).toHaveLength(5)

    // 时间倒序：最新一条在最前
    const times = items.map((item) => Date.parse(item.created_at))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(items[0]!.action).toBe('score.adjust')
    expect(items[0]!.request_id).toBe('req_list_score')
    expect(items[items.length - 1]!.action).toBe('checkin.reopen')

    // 每次都通过 HTTP 操作，request_id 应当与请求头一一对应
    expect(items.map((item) => item.request_id)).toEqual([...requestIds].reverse())

    for (const item of items) {
      expect(item.actor, item.action).toMatchObject({ id: adminId, student_id: 'admin1', role: 'super_admin' })
      expect(item.request_id, item.action).toBeTruthy()
      expect(item.target_id, item.action).toBeTruthy()
      expect(item.created_at, item.action).toBeTruthy()
      // 五个操作都会报告操作后的结果
      expect(item.after, item.action).toBeTruthy()
    }

    // 重开 / 撤销 / 作废报告了修改前的值；补录与积分调整是从无到有，没有前值
    const withBefore = items.filter((item) => item.before).map((item) => item.action).sort()
    expect(withBefore).toEqual(['checkin.reopen', 'review.revoke', 'review.void'])
    expect(items.find((item) => item.action === 'checkin.manual_create')!.before).toBeNull()
    expect(items.find((item) => item.action === 'score.adjust')!.before).toBeNull()
  })

  it('审计日志支持按动作与操作人筛选', async () => {
    await runEveryOperation()

    const byAction = await authed(adminToken).get('/api/v1/admin/audit-logs?action=review.')
    expect(byAction.status, JSON.stringify(byAction.body)).toBe(200)
    expect(byAction.body.total).toBe(2)
    expect((byAction.body.items as Array<{ action: string }>).map((item) => item.action).sort()).toEqual([
      'review.revoke',
      'review.void',
    ])

    const byActor = await authed(adminToken).get(`/api/v1/admin/audit-logs?actor_id=${adminId}`)
    expect(byActor.body.total).toBe(5)

    const byOtherActor = await authed(adminToken).get('/api/v1/admin/audit-logs?actor_id=nobody')
    expect(byOtherActor.body.total).toBe(0)
  })

  it('非超管无法读取审计日志', async () => {
    for (const [label, token] of [
      ['审核员', reviewerToken],
      ['参赛者', participantToken],
    ] as const) {
      const response = await authed(token).get('/api/v1/admin/audit-logs')
      expect(response.status, label).toBe(403)
      expect(response.body.code, label).toBe('ROLE_REQUIRED')
    }

    const anonymous = await api().get('/api/v1/admin/audit-logs')
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401)
    expect(anonymous.body.code).toBe('UNAUTHENTICATED')
  })

  // -------------------------------------------------------------------------
  // 失败的操作不留痕
  // -------------------------------------------------------------------------

  it('操作被拒绝时不写审计 —— 审计只记录真正生效的变更', async () => {
    const entry = await approvedEntry()

    // 版本号对不上 → 409，什么都没改
    const conflict = await adminPost(
      `/api/v1/admin/checkins/${entry.id}/revoke`,
      { version: entry.version + 99, reason: '用错误的版本号发起撤销' },
      'req_audit_conflict',
    )
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409)
    expect(conflict.body.code).toBe('REVIEW_CONFLICT')

    // 缺少原因 → 400，连业务逻辑都没进
    const noReason = await adminPost(
      `/api/v1/admin/checkins/${entry.id}/revoke`,
      { version: entry.version },
      'req_audit_no_reason',
    )
    expect(noReason.status, JSON.stringify(noReason.body)).toBe(400)
    expect(noReason.body.code).toBe('VALIDATION_FAILED')

    expect(await db.auditLog.count()).toBe(0)
    expect(await db.reviewAction.count()).toBe(0)

    // 记录也确实没被动过
    const stored = await db.checkinEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(stored.status).toBe('approved')
    expect(stored.version).toBe(entry.version)
  })
})
