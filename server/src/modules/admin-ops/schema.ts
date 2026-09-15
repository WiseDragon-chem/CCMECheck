import { z } from 'zod'
import { DEFAULT_REOPEN_MINUTES, MAX_REOPEN_MINUTES } from '../../config/constants.js'
import { dateOnlySchema, idSchema } from '../../core/validation.js'

/**
 * §8.5 异常处理的操作载荷。
 *
 * §16.14 要求补录、撤销、积分调整等都产生审计记录，而 §8.5 更直接：
 * 「所有异常操作必须填写原因」。因此 reason 在这里是必填项，而不是可选备注 ——
 * 放到 schema 层强制，就不会有任何一个写操作漏掉原因。
 */

export const adminEntryParamsSchema = z.object({
  entryId: idSchema,
})

/** 操作原因：必填、有长度下限，避免出现「.」这类无意义的原因 */
const reasonSchema = z.string().trim().min(2, '请填写操作原因（至少 2 个字符）').max(1000)

/** 乐观并发令牌，与 reviews 模块共用同一套语义 */
const versionSchema = z.coerce.number().int().min(0)

/** §8.5 临时重新开放某个打卡槽位 */
export const reopenEntryBodySchema = z.object({
  version: versionSchema,
  reason: reasonSchema,
  /** 重新开放的时长（分钟），默认 2 小时，最长一周 */
  reopen_minutes: z.coerce.number().int().min(1).max(MAX_REOPEN_MINUTES).default(DEFAULT_REOPEN_MINUTES),
})

/** §8.5 撤销审核结果 */
export const revokeEntryBodySchema = z.object({
  version: versionSchema,
  reason: reasonSchema,
})

/** §8.5 作废违规记录 */
export const voidEntryBodySchema = z.object({
  version: versionSchema,
  reason: reasonSchema,
})

/** §8.5 管理员补录 */
export const createManualEntryBodySchema = z.object({
  /** campaign_participants.id */
  participant_id: idSchema,
  /** 赛道 id 或 slug */
  track_id: idSchema,
  activity_date: dateOnlySchema,
  reason: reasonSchema,
  /** 补录备注，会写进补录版本的 note */
  note: z.string().trim().max(2000).optional(),
  /** 默认 pending：补录也要走审核；确需直接计入时显式传 approved */
  status: z.enum(['pending', 'approved']).default('pending'),
})

/** §9.1 管理员对特殊记录进行积分调整 */
export const createScoreAdjustmentBodySchema = z.object({
  participant_id: idSchema,
  /** 赛道 id 或 slug，或总榜哨兵值 __overall__ */
  track_id: idSchema,
  /** 整数毫点（1000 = 1 分），可为负 */
  points_delta: z.coerce.number().int().min(-1_000_000).max(1_000_000),
  reason: reasonSchema,
})

export type ReopenEntryBody = z.infer<typeof reopenEntryBodySchema>
export type RevokeEntryBody = z.infer<typeof revokeEntryBodySchema>
export type VoidEntryBody = z.infer<typeof voidEntryBodySchema>
export type CreateManualEntryBody = z.infer<typeof createManualEntryBodySchema>
export type CreateScoreAdjustmentBody = z.infer<typeof createScoreAdjustmentBodySchema>
