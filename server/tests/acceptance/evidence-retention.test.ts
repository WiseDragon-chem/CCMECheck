import { describe, expect, it, beforeEach } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { purgeExpiredEvidence } from '../../src/jobs/definitions/purge-expired-evidence.job.js'
import { cst } from '../helpers/time.js'
import { createCampaign, createDefaultTracks, createEntry, createParticipant, createUser } from '../helpers/factory.js'

/**
 * 证明材料保留期（design.md §18.8）。
 *
 * 这是不可逆的破坏性操作，所以测试的重点不是「能删」，而是
 * **不该删的时候一条都不动**。
 */
describe('证明材料保留期清理', () => {
  const db = getPrismaClient()
  // 以今天为基准：2026-09-16
  const NOW = cst('2026-09-16', '12:00:00')

  /** 造一个在某日结束、带一条带材料的打卡记录的活动 */
  async function seedCampaign(name: string, endDate: string) {
    const tracks = await db.track.findMany({ orderBy: { sortOrder: 'asc' } })
    if (tracks.length === 0) await createDefaultTracks(db)

    const allTracks = await db.track.findMany({ orderBy: { sortOrder: 'asc' } })
    const campaign = await createCampaign({
      name,
      startDate: '2026-08-01',
      endDate,
      db,
    })
    const user = await createUser({ studentId: `u-${name}`, name: `参与者-${name}` })
    const participant = await createParticipant({ campaignId: campaign.id, userId: user.id })
    const created = await createEntry({
      campaignId: campaign.id,
      participantId: participant.id,
      trackId: allTracks[0]!.id,
      activityDate: '2026-08-01',
      status: 'approved',
      withAsset: true,
      note: `${name} 的打卡`,
    })
    void tracks
    return { campaign, entryId: created.entry.id }
  }

  beforeEach(async () => {
    await createDefaultTracks(db)
  })

  it('保留期为 0 时什么都不删 —— 这是默认状态', async () => {
    // 活动早在一年前就结束了，但没配置保留期就不该动它
    await seedCampaign('老活动', '2025-01-01')
    expect(await db.submissionAsset.count()).toBe(1)

    const deleted = await purgeExpiredEvidence(0, NOW)

    expect(deleted).toBe(0)
    expect(await db.submissionAsset.count()).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'evidence.purge' } })).toBe(0)
  })

  it('负数同样视为不清理', async () => {
    await seedCampaign('老活动', '2025-01-01')
    expect(await purgeExpiredEvidence(-5, NOW)).toBe(0)
    expect(await db.submissionAsset.count()).toBe(1)
  })

  it('活动结束超过保留期的，材料被删除', async () => {
    const { entryId } = await seedCampaign('老活动', '2026-08-01') // 46 天前

    const deleted = await purgeExpiredEvidence(30, NOW)

    expect(deleted).toBe(1)
    expect(await db.submissionAsset.count()).toBe(0)

    // 打卡记录必须保留 —— 只清材料，不删记录
    const entry = await db.checkinEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.status).toBe('approved')
  })

  it('活动结束未超过保留期的，一条都不动', async () => {
    // 结束 10 天，保留期 30 天 —— 还没到期
    await seedCampaign('新活动', '2026-09-06')

    const deleted = await purgeExpiredEvidence(30, NOW)

    expect(deleted).toBe(0)
    expect(await db.submissionAsset.count()).toBe(1)
  })

  it('多个活动时只清理过期的那些', async () => {
    await seedCampaign('已过期', '2026-07-01')
    await seedCampaign('未过期', '2026-09-10')
    expect(await db.submissionAsset.count()).toBe(2)

    const deleted = await purgeExpiredEvidence(30, NOW)

    expect(deleted).toBe(1)
    expect(await db.submissionAsset.count()).toBe(1)

    // 留下的那一条属于未过期的活动
    const remaining = await db.submissionAsset.findFirstOrThrow({
      include: { revision: { include: { entry: { include: { campaign: true } } } } },
    })
    expect(remaining.revision.entry.campaign.name).toBe('未过期')
  })

  it('备注也随之清空 —— 它同样可能含个人信息', async () => {
    const { entryId } = await seedCampaign('老活动', '2026-08-01')

    await purgeExpiredEvidence(30, NOW)

    const revision = await db.submissionRevision.findFirstOrThrow({ where: { entryId } })
    expect(revision.note).toBeNull()
  })

  it('清理动作写入审计 —— 即使是系统发起的', async () => {
    await seedCampaign('老活动', '2026-08-01')
    await purgeExpiredEvidence(30, NOW)

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'evidence.purge' } })
    // 系统发起，没有操作人
    expect(audit.actorId).toBeNull()
    expect(audit.afterData).toContain('30')
    expect(audit.afterData).toContain('老活动')
  })

  it('边界：结束日恰好等于截止日时不删', async () => {
    // 保留期 30 天，NOW 是 09-16，那么 08-17 结束的活动才刚好满 30 天。
    // 实现用的是 endDate < cutoffDate，所以恰好等于的那天不删。
    await seedCampaign('刚好满期', '2026-08-17')

    const deleted = await purgeExpiredEvidence(30, NOW)
    expect(deleted).toBe(0)
  })

  it('空数据库上执行不报错', async () => {
    await expect(purgeExpiredEvidence(30, NOW)).resolves.toBe(0)
  })
})
