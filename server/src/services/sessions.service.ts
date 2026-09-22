import type { Db } from '../db/client.js'

/**
 * 刷新会话的批量操作。
 *
 * 长期刷新令牌是随机串、只存哈希、走 HttpOnly Cookie（见 tokens.service.ts 的说明），
 * 这里只管它们在 refresh_sessions 里的生命周期。
 *
 * 「撤销某人的全部会话」原先散在禁用、重置密码、匿名化与改密四处各写一遍，
 * 收在这里是因为它的语义必须一致：任何一处漏掉，都会留下「账号已经不能用了、
 * 但旧刷新令牌还能换到新访问令牌」的窗口（design.md §7.2）。
 */

/**
 * 撤销某个账号的全部刷新会话，返回撤销条数。
 *
 * 必须在事务内调用 —— 撤销会话是账号状态变更的一部分，要与业务写入同生共死，
 * 否则会出现「账号已禁用、会话还活着」的中间状态。因此只收 `Db`（事务客户端），
 * 不收 PrismaClient：传错了会在类型上被拦下。
 *
 * 返回的条数直接用作响应里的 `revoked_sessions` 与审计字段。
 */
export async function revokeAllSessions(tx: Db, userId: string, at: Date = new Date()): Promise<number> {
  const result = await tx.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: at },
  })
  return result.count
}
