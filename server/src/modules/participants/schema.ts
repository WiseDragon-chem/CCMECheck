import { z } from 'zod'
import { PARTICIPANT_STATUSES } from '../../config/constants.js'
import { idSchema, optionalTrimmed, paginationSchema } from '../../core/validation.js'

/**
 * 名单管理模块的请求校验（design.md §7.1、§8.3）。
 *
 * 请求体与查询串一律 snake_case，与响应体保持一致，
 * 避免前端在同一个模块里两套命名来回切换。
 */

/** 学号在 users.studentId 上唯一，长度上限与 auth 模块保持一致 */
const studentIdSchema = z.string().trim().min(1, '请填写学号').max(64, '学号过长')
const nameSchema = z.string().trim().min(1, '请填写姓名').max(64, '姓名过长')

export const participantParamsSchema = z.object({
  participantId: idSchema,
})

/**
 * 预览返回的 batch_id 由服务端生成，正式导入时必须原样回传；
 * 服务端会据此重新读取暂存的原始文件，而不是信任客户端带来的解析结果（§7.1）。
 */
export const importCommitBodySchema = z.object({
  batch_id: idSchema,
})

export const listParticipantsQuerySchema = paginationSchema.extend({
  /** 参赛者在本活动内的状态；账号级状态见响应中的 account_status */
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  class_name: optionalTrimmed(64),
  keyword: optionalTrimmed(64),
})

export const createParticipantBodySchema = z.object({
  student_id: studentIdSchema,
  name: nameSchema,
  class_name: optionalTrimmed(64),
  phone_suffix: optionalTrimmed(16),
  remark: optionalTrimmed(200),
})

export const updateParticipantStatusBodySchema = z.object({
  /**
   * §8.3 的名单管理只提供「启用 / 禁用」。
   * anonymized 属于单独的匿名化流程（§8.3 末段），不能通过这个接口写入 ——
   * 一旦误设为 anonymized，参赛者的姓名快照就再也回不来了。
   */
  status: z.enum(['active', 'disabled']),
})

export type ParticipantParams = z.infer<typeof participantParamsSchema>
export type ImportCommitBody = z.infer<typeof importCommitBodySchema>
export type ListParticipantsQuery = z.infer<typeof listParticipantsQuerySchema>
export type CreateParticipantBody = z.infer<typeof createParticipantBodySchema>
export type UpdateParticipantStatusBody = z.infer<typeof updateParticipantStatusBodySchema>
