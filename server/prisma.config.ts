import { defineConfig, env } from 'prisma/config'

// Prisma 7 起不再自动加载 .env，改用 Node 内置的 loadEnvFile。
// 已经显式提供 DATABASE_URL 时（CI、测试脚本）不再读 .env，
// 否则测试库会被开发库的连接串覆盖掉。
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env')
  } catch {
    // 没有 .env 文件，使用进程已有的环境变量
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
