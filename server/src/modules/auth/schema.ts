import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../core/password.js'

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码不能超过 ${PASSWORD_MAX_LENGTH} 位`)
  .regex(/[A-Za-z]/, '密码需要包含字母')
  .regex(/\d/, '密码需要包含数字')

const studentIdSchema = z.string().trim().min(1, '请填写学号').max(64, '学号过长')

export const activateBodySchema = z.object({
  studentId: studentIdSchema,
  activationCode: z.string().trim().min(6, '请填写激活码').max(128, '激活码过长'),
  password: passwordSchema,
})

export const loginBodySchema = z.object({
  studentId: studentIdSchema,
  password: z.string().min(1, '请填写密码').max(PASSWORD_MAX_LENGTH),
})

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, '请填写当前密码').max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
})

export type ActivateBody = z.infer<typeof activateBodySchema>
export type LoginBody = z.infer<typeof loginBodySchema>
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>
