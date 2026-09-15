import { Router } from 'express'
import { notFound } from '../../core/errors.js'
import { route } from '../../core/route.js'
import { getPrismaClient } from '../../db/client.js'
import { authenticate, requirePrincipal } from '../../middleware/authenticate.js'
import { toPublicUser } from './serializer.js'

export function createUsersRouter(): Router {
  const router = Router()

  router.get(
    '/me',
    authenticate,
    route({}, async ({ req, res }) => {
      const principal = requirePrincipal(req)
      const prisma = getPrismaClient()
      const user = await prisma.user.findUnique({ where: { id: principal.userId } })
      // authenticate 中间件已加载过该用户，这里只有并发删除才会走到
      if (!user) throw notFound('账号不存在')
      res.json({ user: toPublicUser(user) })
    }),
  )

  return router
}
