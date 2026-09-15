import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../core/password.js'

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码不能超过 ${PASSWORD_MAX_LENGTH} 位`)
  .regex(/[A-Za-z]/, '密码需要包含字母')
  .regex(/\d/, '密码需要包含数字')

const studentIdSchema = z.string().trim().min(1, '请填写学号').max(64, '学号过长')

/**
 * 请求体字段一律 snake_case，与其余所有模块（batch_id、student_id、reason_code…）保持一致。
 * 这里曾经用过 camelCase，是全局约定里唯一的破例，
 * 结果是前端按肌肉记忆写 student_id 会直接拿到 400。
 */
export const activateBodySchema = z.object({
  student_id: studentIdSchema,
  activation_code: z.string().trim().min(6, '请填写激活码').max(128, '激活码过长'),
  password: passwordSchema,
})

export const loginBodySchema = z.object({
  student_id: studentIdSchema,
  password: z.string().min(1, '请填写密码').max(PASSWORD_MAX_LENGTH),
})

export const changePasswordBodySchema = z.object({
  current_password: z.string().min(1, '请填写当前密码').max(PASSWORD_MAX_LENGTH),
  new_password: passwordSchema,
})

export type ActivateBody = z.infer<typeof activateBodySchema>
export type LoginBody = z.infer<typeof loginBodySchema>
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>
