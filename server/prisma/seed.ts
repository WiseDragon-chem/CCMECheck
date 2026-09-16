import { configurePragmas, createPrismaClient } from '../src/db/client.js'
import { DEFAULT_TRACKS } from '../src/config/constants.js'
import { env } from '../src/config/env.js'
import { randomToken } from '../src/core/crypto.js'
import { hashPassword } from '../src/core/password.js'

/**
 * 初始化数据：超级管理员 + 审核员 + 三个赛道。
 *
 * 刻意不预置活动：活动与计分规则定义在 `src/config/campaign.ts` 里，
 * 由 `npm run campaign:init` 写入。两件事分开是因为它们的时点不同 ——
 * 赛道与账号是系统的底座，活动是每个活动期各来一次。
 *
 * 幂等：重复执行不会覆盖已有数据，也不会重置已有账号的密码。
 */
async function main(): Promise<void> {
  const prisma = createPrismaClient()
  try {
    await configurePragmas(prisma)

    // ---- 赛道 ----
    for (const track of DEFAULT_TRACKS) {
      await prisma.track.upsert({
        where: { slug: track.slug },
        update: {
          name: track.name,
          description: track.description,
          icon: track.icon,
          proofInstructions: track.proofInstructions,
          sortOrder: track.sortOrder,
        },
        create: {
          slug: track.slug,
          name: track.name,
          description: track.description,
          icon: track.icon,
          proofInstructions: track.proofInstructions,
          sortOrder: track.sortOrder,
        },
      })
    }
    console.log(`✔ 赛道就绪：${DEFAULT_TRACKS.map((t) => `${t.slug}(${t.name})`).join('、')}`)

    // ---- 超级管理员 ----
    const { studentId, name, password } = env.seedAdmin
    const existing = await prisma.user.findUnique({ where: { studentId } })

    if (existing) {
      // 已存在则不重置密码，避免重跑 seed 把线上口令改掉
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'super_admin', name },
      })
      console.log(`✔ 超级管理员已存在，未改动密码：${studentId}`)
    } else {
      const generated = password ?? randomToken(12)
      await prisma.user.create({
        data: {
          studentId,
          name,
          role: 'super_admin',
          status: 'active',
          passwordHash: await hashPassword(generated),
          passwordChangedAt: new Date(),
        },
      })
      console.log(`✔ 已创建超级管理员：${studentId}`)
      if (!password) {
        console.log(`  首次登录密码（仅显示这一次，请立即修改）：${generated}`)
      } else {
        console.log('  首次登录密码取自 SEED_ADMIN_PASSWORD 环境变量')
      }
    }

    // ---- 审核员 ----
    //
    // §5 要求超管能管理管理员账号，但那套接口尚不存在。在其他办法之前，
    // 审核员只能由这里创建 —— 没有审核员，系统上线后没人能审材料。
    const reviewer = env.seedReviewer
    const existingReviewer = await prisma.user.findUnique({ where: { studentId: reviewer.studentId } })

    if (existingReviewer) {
      // 同样不动密码；但角色要纠正过来，否则账号可能被改成了参赛者
      await prisma.user.update({
        where: { id: existingReviewer.id },
        data: { role: 'reviewer', name: reviewer.name },
      })
      console.log(`✔ 审核员已存在，未改动密码：${reviewer.studentId}`)
    } else {
      const generated = reviewer.password ?? randomToken(12)
      await prisma.user.create({
        data: {
          studentId: reviewer.studentId,
          name: reviewer.name,
          role: 'reviewer',
          status: 'active',
          passwordHash: await hashPassword(generated),
          passwordChangedAt: new Date(),
        },
      })
      console.log(`✔ 已创建审核员：${reviewer.studentId}`)
      if (!reviewer.password) {
        console.log(`  首次登录密码（仅显示这一次，请立即修改）：${generated}`)
      } else {
        console.log('  首次登录密码取自 SEED_REVIEWER_PASSWORD 环境变量')
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('种子数据写入失败：', error)
  process.exitCode = 1
})
