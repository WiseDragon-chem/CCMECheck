import { z } from 'zod'
import { ENTRY_STATUSES } from '../../config/constants.js'
import { dateOnlySchema, idSchema, paginationSchema } from '../../core/validation.js'

export const checkinEntryParamsSchema = z.object({
  entryId: idSchema,
})

export const assetParamsSchema = z.object({
  entryId: idSchema,
  assetId: idSchema,
})

export const assetOnlyParamsSchema = z.object({
  assetId: idSchema,
})

export const signedAssetQuerySchema = z.object({
  exp: z.string().optional(),
  uid: z.string().optional(),
  sig: z.string().optional(),
})

export const listCheckinsQuerySchema = z
  .object({
    track: z.string().trim().min(1).max(64).optional(),
    status: z.enum(ENTRY_STATUSES).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .merge(paginationSchema)

/**
 * POST /checkins 走 multipart/form-data，所有字段都是文本，
 * 所以数值与布尔值在这里手工转换。
 */
export const submitCheckinFieldsSchema = z.object({
  track: z.string().trim().min(1, '请选择赛道').max(64),
  activity_date: dateOnlySchema,
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value)),
  /** 客户端生成的幂等键，防止重复点击产生重复版本（design.md §7.4） */
  client_token: z
    .string()
    .trim()
    .min(8, 'client_token 至少 8 位')
    .max(128, 'client_token 过长')
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === '' ? null : value)),
})

export type SubmitCheckinFields = z.infer<typeof submitCheckinFieldsSchema>
export type ListCheckinsQuery = z.infer<typeof listCheckinsQuerySchema>
