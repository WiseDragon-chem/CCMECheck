import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './core/logger.js'
import { configurePragmas, disconnectPrismaClient, getPrismaClient } from './db/client.js'
import { startScheduler, stopScheduler } from './jobs/scheduler.js'

async function bootstrap(): Promise<void> {
  const prisma = getPrismaClient()

  const { journalMode, foreignKeys } = await configurePragmas(prisma)
  logger.info({ journal_mode: journalMode, foreign_keys: foreignKeys }, 'sqlite pragmas applied')

  if (journalMode !== 'wal') {
    // WAL 是 design.md §10.2「单进程 + 写入串行」前提的一部分。
    // 放在同步盘（OneDrive 等）上会静默退化成 delete 模式。
    logger.warn({ journal_mode: journalMode }, 'SQLite 未运行在 WAL 模式，写入并发行为可能与设计不符')
  }
  if (!foreignKeys) {
    logger.warn('SQLite 外键约束未启用，数据完整性依赖应用层保证')
  }

  const app = createApp()
  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, base_url: env.publicBaseUrl },
      `CCME 打卡平台后端已启动：http://localhost:${env.port}`,
    )
  })

  // 定时任务与 HTTP 服务同进程（design.md §10.2：SQLite 单写入者，必须单进程）
  startScheduler({ enabled: env.schedulerEnabled })

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '收到退出信号，正在优雅关闭')
    stopScheduler()
    server.close()
    await disconnectPrismaClient()
    process.exit(0)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal)
    })
  }
}

bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, '启动失败')
  process.exitCode = 1
})
