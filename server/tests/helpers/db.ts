import type { PrismaClient } from '../../src/db/client.js'

/**
 * 清空顺序按外键依赖从叶到根排列。
 * 即使开了 ON DELETE CASCADE 也显式列出，避免将来某张表的级联被去掉后
 * 测试之间悄悄串数据。
 */
const DELETE_ORDER = [
  'leaderboardRow',
  'leaderboardSnapshot',
  'reviewAction',
  'submissionAsset',
  'submissionRevision',
  'checkinEntry',
  'scoreAdjustment',
  'importBatch',
  'campaignParticipant',
  'campaignTrack',
  'campaign',
  'auditLog',
  'jobRun',
  'jobLock',
  'refreshSession',
  'activationToken',
  'user',
  'track',
] as const

export async function truncateAllTables(prisma: PrismaClient): Promise<void> {
  // checkin_entries.current_revision_id → submission_revisions.id 是一条循环外键
  // （version 用 NoAction，不允许级联）。不清掉这个引用，
  // 先删 submission_revisions 就会违反外键约束。
  await prisma.checkinEntry.updateMany({ data: { currentRevisionId: null } })

  for (const model of DELETE_ORDER) {
    // 各模型的 deleteMany 签名一致，这里用动态取值避免重复 18 段样板
    const delegate = prisma[model] as unknown as { deleteMany: (args?: unknown) => Promise<unknown> }
    await delegate.deleteMany({})
  }
}
