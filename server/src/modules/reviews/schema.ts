import { z } from 'zod'
import { REJECT_REASON_CODE_VALUES, type RejectReasonCode } from '../../config/constants.js'
import { dateOnlySchema, idSchema, optionalTrimmed, paginationSchema } from '../../core/validation.js'

/**
 * REJECT_REASON_CODES 在 constants 里是普通数组，而 z.enum 需要字面量元组才能推导出联合类型。
 * 这里只做类型收窄，取值仍以 constants 为唯一来源，避免两处定义漂移。
 */
const rejectReasonCodeSchema = z.enum(
  REJECT_REASON_CODE_VALUES as unknown as [RejectReasonCode, ...RejectReasonCode[]],
)

/** 活动日筛选允许整体缺省；前端清空筛选项时通常传空串，这里统一归一为 undefined */
const optionalActivityDateSchema = z
  .union([z.literal(''), dateOnlySchema])
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value))

export const reviewQueueQuerySchema = paginationSchema.extend({
  /** 赛道 slug */
  track: optionalTrimmed(64),
  activity_date: optionalActivityDateSchema,
  /** 缺省表示全部班级（design.md §8.2 左侧筛选器） */
  class_name: optionalTrimmed(120),
})

export const reviewEntryParamsSchema = z.object({
  entryId: idSchema,
})

/**
 * version 是打开详情面板时拿到的版本号，审核时原样回传。
 * 用 coerce 是因为部分客户端会把数字序列化成字符串，解析失败会变成 NaN 而被下面的
 * int/min 拦下，不会静默退化成 0。
 */
const versionSchema = z.coerce.number().int().min(0)

export const approveReviewBodySchema = z.object({
  version: versionSchema,
  /** 审核备注，可选；通过时不需要理由 */
  note: z.string().trim().max(2000).optional(),
})

export const rejectReviewBodySchema = z
  .object({
    version: versionSchema,
    reason_code: rejectReasonCodeSchema,
    /** 补充说明；选「其他」时必填（design.md §8.2：驳回必须填写原因） */
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.reason_code !== 'other' || (value.reason?.length ?? 0) > 0, {
    message: '选择「其他」时必须填写具体驳回原因',
    path: ['reason'],
  })

export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>
export type ApproveReviewBody = z.infer<typeof approveReviewBodySchema>
export type RejectReviewBody = z.infer<typeof rejectReviewBodySchema>
