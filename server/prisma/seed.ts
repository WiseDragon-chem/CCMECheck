import { configurePragmas, createPrismaClient } from '../src/db/client.js'
import { DEFAULT_TRACKS } from '../src/config/constants.js'
import { env } from '../src/config/env.js'
import { randomToken } from '../src/core/crypto.js'
import { hashPassword } from '../src/core/password.js'

/**
 * 初始化数据：超级管理员 + 三个赛道。
 * 刻意不预置活动 —— 活动与其计分规则由管理员按真实规则在后台创建。
 *
 * 幂等：重复执行不会覆盖已有数据。
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
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('种子数据写入失败：', error)
  process.exitCode = 1
})
