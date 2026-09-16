import { beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'

/**
 * 匿名化（design.md §8.3 末段）。
 *
 * 「已有正式记录的参赛者不允许直接删除，可进行禁用或匿名化处理」——
 * 之所以不能删是因为记录要用于统计与审计，匿名化则是保留记录、去掉与人的关联。
 *
 * 这一组测试的重点是：**该抹的抹干净、该留的一条不少**。
 * 抹不干净是隐私事故，删多了是数据事故。
 */
describe('参赛者匿名化', () => {
  const db = getPrismaClient()

  let campaignId: string
  let participantId: string
  let participantUserId: string
  let adminToken: string
  let entryId: string

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({ startDate: '2026-09-12', endDate: '2026-09-19' })
    campaignId = campaign.id

    const student = await createUser({ studentId: '2026001', name: '张三' })
    participantUserId = student.id
    const participant = await createParticipant({
      campaignId,
      userId: student.id,
      className: '化学 1 班',
    })
    participantId = participant.id
    await db.campaignParticipant.update({
      where: { id: participant.id },
      data: { phoneSuffix: '1234', remark: '班长', studentIdSnapshot: '2026001', nameSnapshot: '张三' },
    })

    // 一条带证明材料的记录 —— 匿名化默认要把材料一起删掉
    const created = await createEntry({
      campaignId,
      participantId,
      trackId: tracks[0]!.id,
      activityDate: '2026-09-13',
      status: 'approved',
      withAsset: true,
      note: '这是张三的读书打卡',
    })
    entryId = created.entry.id

    await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken
  })

  function anonymize(body: Record<string, unknown> = {}) {
    return authed(adminToken)
      .post(`/api/v1/admin/participants/${participantId}/anonymize`)
      .send({ reason: '学生本人申请删除个人信息', ...body })
  }

  it('抹除身份信息，但保留打卡记录', async () => {
    const response = await anonymize()
    expect(response.status, JSON.stringify(response.body)).toBe(200)

    const user = await db.user.findUniqueOrThrow({ where: { id: participantUserId } })
    expect(user.name).toBe('匿名用户')
    expect(user.studentId).not.toBe('2026001')
    expect(user.studentId.startsWith('anon-')).toBe(true)
    // 匿名化后不应再能登录
    expect(user.passwordHash).toBeNull()
    expect(user.status).toBe('disabled')

    const participant = await db.campaignParticipant.findUniqueOrThrow({ where: { id: participantId } })
    expect(participant.status).toBe('anonymized')
    expect(participant.className).toBeNull()
    expect(participant.phoneSuffix).toBeNull()
    expect(participant.remark).toBeNull()
    expect(participant.studentIdSnapshot).toBeNull()
    expect(participant.nameSnapshot).toBeNull()

    // 打卡记录必须还在 —— 这正是「不能删除，只能匿名化」的意义
    const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.status).toBe('approved')
    expect(entry.participantId).toBe(participantId)
  })

  it('默认连同证明材料一起删除 —— 截图里常常带着姓名', async () => {
    expect(await db.submissionAsset.count()).toBe(1)

    const response = await anonymize()
    expect(response.status).toBe(200)
    expect(response.body.deleted_assets).toBe(1)

    expect(await db.submissionAsset.count()).toBe(0)
    // 备注也是参赛者自由填写的内容，可能含姓名
    const revision = await db.submissionRevision.findFirstOrThrow({ where: { entryId } })
    expect(revision.note).toBeNull()
  })

  it('显式关掉时可以保留证明材料（争议未了结时）', async () => {
    const response = await anonymize({ delete_evidence: false })
    expect(response.status).toBe(200)
    expect(response.body.deleted_assets).toBe(0)

    expect(await db.submissionAsset.count()).toBe(1)
    const revision = await db.submissionRevision.findFirstOrThrow({ where: { entryId } })
    expect(revision.note).toBe('这是张三的读书打卡')
  })

  it('撤销全部登录会话', async () => {
    await login('2026001', TEST_PASSWORD)
    expect(await db.refreshSession.count({ where: { userId: participantUserId, revokedAt: null } })).toBe(1)

    const response = await anonymize()
    expect(response.body.revoked_sessions).toBe(1)
    expect(await db.refreshSession.count({ where: { userId: participantUserId, revokedAt: null } })).toBe(0)
  })

  it('清理掉未使用的激活码', async () => {
    await db.activationToken.create({
      data: {
        userId: participantUserId,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    await anonymize()
    expect(await db.activationToken.count({ where: { userId: participantUserId } })).toBe(0)
  })

  it('匿名化后不再出现在排行榜上', async () => {
    await anonymize()
    // 计分引擎按 status != 'anonymized' 过滤，所以榜单里不该再有这个人
    const remaining = await db.campaignParticipant.count({
      where: { campaignId, status: { not: 'anonymized' } },
    })
    expect(remaining).toBe(0)
  })

  it('必须填写原因，且写入审计', async () => {
    const missingReason = await anonymize({ reason: '' })
    expect(missingReason.status).toBe(400)
    expect(missingReason.body.code).toBe('VALIDATION_FAILED')

    await anonymize()
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'participant.anonymize' } })
    expect(audit.actorId).not.toBeNull()
    // 前后值都要留痕：匿名化不可逆，审计是唯一的追溯手段
    expect(audit.beforeData).toContain('张三')
    expect(audit.beforeData).toContain('2026001')
    expect(audit.afterData).toContain('学生本人申请删除个人信息')
  })

  it('已经匿名化过的不允许重复操作', async () => {
    expect((await anonymize()).status).toBe(200)

    const again = await anonymize()
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('STATE_TRANSITION_INVALID')
  })

  it('审核员无权匿名化', async () => {
    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    const reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken

    const response = await authed(reviewerToken)
      .post(`/api/v1/admin/participants/${participantId}/anonymize`)
      .send({ reason: '试图越权' })

    expect(response.status).toBe(403)
  })
})
