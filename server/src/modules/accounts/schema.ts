import { z } from 'zod'
import { idSchema, optionalTrimmed, paginationSchema } from '../../core/validation.js'

/**
 * 后台账号管理的请求校验（design.md §5「管理管理员账号」）。
 *
 * 只管 reviewer 与 super_admin 两种角色 —— 参赛者在名单页
 * （modules/participants）管理，两套名单互不重叠。
 * 请求体与查询串一律 snake_case，与响应体保持一致。
 */

/**
 * 本模块可管理的角色。
 *
 * 刻意不含 participant：本模块不建参赛记录，把一个账号改成 participant
 * 会造出一个没有参赛记录的参赛者 —— 名单页看不见它，后台也管不了它。
 */
export const ACCOUNT_ROLES = ['reviewer', 'super_admin'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

/** 学号在 users.studentId 上唯一，长度上限与 participants、auth 模块保持一致 */
const studentIdSchema = z.string().trim().min(1, '请填写学号').max(64, '学号过长')
const nameSchema = z.string().trim().min(1, '请填写姓名').max(64, '姓名过长')

export const accountParamsSchema = z.object({
  accountId: idSchema,
})

export const listAccountsQuerySchema = paginationSchema.extend({
  role: z.enum(ACCOUNT_ROLES).optional(),
  keyword: optionalTrimmed(64),
})

export const createAccountBodySchema = z.object({
  student_id: studentIdSchema,
  name: nameSchema,
  role: z.enum(ACCOUNT_ROLES),
})

/**
 * 改名 / 改角色 / 启用禁用共用一个 PATCH。
 *
 * 不拆成多个端点，是因为「至少保留一个活跃超管」这条不变量同时被 role 与 status
 * 触发（降级与禁用对它的威胁完全等价）—— 拆开就要在两个 handler 里各写一遍
 * 不变量推理，漏写一处等于永久失去所有超管。审计动作由实际差异推导，见 service。
 */
export const updateAccountBodySchema = z
  .object({
    name: nameSchema.optional(),
    role: z.enum(ACCOUNT_ROLES).optional(),
    /** 只提供启用/禁用；pending_activation 属于激活流程，后台账号不走那条路 */
    status: z.enum(['active', 'disabled']).optional(),
  })
  // 空 body 必须拒绝：它会留下一条什么都没改的审计记录
  .refine((value) => value.name !== undefined || value.role !== undefined || value.status !== undefined, {
    message: '请至少提供一个要修改的字段',
  })
