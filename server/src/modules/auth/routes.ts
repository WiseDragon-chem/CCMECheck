import { Router } from 'express'
import { env } from '../../config/env.js'
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../../core/cookies.js'
import { AppError } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { activateRateLimiter, loginRateLimiter, refreshRateLimiter } from '../../middleware/rate-limit.js'
import { activateBodySchema, changePasswordBodySchema, loginBodySchema } from './schema.js'
import * as authService from './service.js'

const REFRESH_TTL_MS = env.refreshTokenTtlDays * 24 * 60 * 60 * 1000

function authPayload(result: authService.AuthResult) {
  return {
    user: result.user,
    access_token: result.tokens.accessToken,
    token_type: 'Bearer' as const,
    expires_in: result.tokens.accessTokenExpiresIn,
  }
}

export function createAuthRouter(): Router {
  const router = Router()

  // ---- 激活 ----
  router.post(
    '/activate',
    activateRateLimiter,
    route({ body: activateBodySchema }, async ({ req, res, body }) => {
      const result = await authService.activateAccount({
        studentId: body.student_id,
        activationCode: body.activation_code,
        password: body.password,
        deviceInfo: req.header('user-agent'),
      })
      setRefreshCookie(res, result.tokens.refreshToken, REFRESH_TTL_MS)
      res.status(201).json(authPayload(result))
    }),
  )

  // ---- 登录 ----
  router.post(
    '/login',
    loginRateLimiter,
    route({ body: loginBodySchema }, async ({ req, res, body }) => {
      const result = await authService.login({
        studentId: body.student_id,
        password: body.password,
        deviceInfo: req.header('user-agent'),
      })
      setRefreshCookie(res, result.tokens.refreshToken, REFRESH_TTL_MS)
      res.json(authPayload(result))
    }),
  )

  // ---- 刷新（轮换）----
  router.post(
    '/refresh',
    refreshRateLimiter,
    route({}, async ({ req, res }) => {
      const refreshToken = readRefreshCookie(req.cookies)
      if (!refreshToken) throw new AppError('UNAUTHENTICATED', '缺少刷新令牌，请重新登录')

      const result = await authService.rotateRefreshToken({
        refreshToken,
        deviceInfo: req.header('user-agent'),
      })
      setRefreshCookie(res, result.tokens.refreshToken, REFRESH_TTL_MS)
      res.json(authPayload(result))
    }),
  )

  // ---- 退出 ----
  // 不要求 access token 有效：令牌过期后用户仍应能清掉自己的会话
  router.post(
    '/logout',
    route({}, async ({ req, res }) => {
      await authService.logout(readRefreshCookie(req.cookies))
      clearRefreshCookie(res)
      res.status(204).send()
    }),
  )

  // ---- 修改密码 ----
  router.post(
    '/change-password',
    authenticate,
    route({ body: changePasswordBodySchema }, async ({ req, res, body }) => {
      const principal = requirePrincipal(req)
      const result = await authService.changePassword({
        userId: principal.userId,
        currentPassword: body.current_password,
        newPassword: body.new_password,
        deviceInfo: req.header('user-agent'),
      })
      setRefreshCookie(res, result.tokens.refreshToken, REFRESH_TTL_MS)
      res.json(authPayload(result))
    }),
  )

  return router
}
