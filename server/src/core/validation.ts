import { z } from 'zod'
import { isDateOnly, isTimeOfDay } from './time.js'

/** 可复用的 Zod 片段，供各模块的 schema 组合 */

export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, { message: '日期格式应为 YYYY-MM-DD，且必须是真实存在的日期' })

export const timeOfDaySchema = z
  .string()
  .refine(isTimeOfDay, { message: '时间格式应为 HH:mm（24 小时制）' })

export const idSchema = z.string().trim().min(1).max(64)

/** 从查询串传入的布尔值 */
export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
})

export type Pagination = z.infer<typeof paginationSchema>

export function paginationToSkipTake(pagination: Pagination): { skip: number; take: number } {
  return { skip: (pagination.page - 1) * pagination.page_size, take: pagination.page_size }
}

/** 把可能为空的查询参数规整成可选值 */
export function optionalTrimmed(maxLength = 200) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value))
}
