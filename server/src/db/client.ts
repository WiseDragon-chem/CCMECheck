import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

/**
 * 能在事务体内使用的客户端。
 *
 * 服务层的辅助函数一律接受这个类型而不是 PrismaClient，
 * 这样既能在事务外直接调用，也能把 $transaction 回调里的 tx 传进去 ——
 * PrismaClient 结构上满足 Omit 后的形状，所以两种调用都成立。
 */
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>

export type Db = TransactionClient

export type { PrismaClient }

export interface CreatePrismaClientOptions {
  /** 数据库文件绝对路径，或 ':memory:'。默认取 env.databaseFile */
  databaseFile?: string
  /** busy_timeout，毫秒。SQLite 写锁等待时间，超时前不会立即报错。 */
  busyTimeoutMs?: number
}

/**
 * 构造 PrismaClient。
 *
 * Prisma 7 的 Rust-free 客户端要求显式 driver adapter，连接串不再写在 schema 里。
 * 用 better-sqlite3 adapter 的附带好处是 busy_timeout 能在构造参数里正经设置，
 * 不必靠启动时打 PRAGMA 补丁（design.md §11.2 要求写入冲突时短暂重试而非立即报错）。
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const databaseFile = options.databaseFile ?? env.databaseFile
  const url = databaseFile === ':memory:' ? ':memory:' : `file:${databaseFile}`

  const adapter = new PrismaBetterSqlite3({
    url,
    timeout: options.busyTimeoutMs ?? 5_000,
  })

  return new PrismaClient({ adapter })
}

/**
 * 设置并校验连接级 PRAGMA。
 *
 * journal_mode = WAL 是写入数据库文件头的持久设置，设置一次后一直有效；
 * foreign_keys 是每连接设置，必须每次进程启动都设。
 * 这些设置直接决定 §10.2「单进程 + 写入串行」的假设能否成立。
 */
export async function configurePragmas(prisma: PrismaClient): Promise<{ journalMode: string; foreignKeys: boolean }> {
  const journalRows = await prisma.$queryRawUnsafe<Array<{ journal_mode: unknown }>>('PRAGMA journal_mode = WAL')
  const journalMode = String(journalRows[0]?.journal_mode ?? 'unknown').toLowerCase()

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const fkRows = await prisma.$queryRawUnsafe<Array<{ foreign_keys: unknown }>>('PRAGMA foreign_keys')
  // SQLite 通过 driver adapter 返回的是 BigInt，不能直接与 number 比较
  const foreignKeys = Number(fkRows[0]?.foreign_keys ?? 0) === 1

  return { journalMode, foreignKeys }
}

let sharedClient: PrismaClient | null = null

/** 进程级单例。定时任务与 HTTP 服务共用同一个客户端（design.md §10.2 单进程部署）。 */
export function getPrismaClient(): PrismaClient {
  if (!sharedClient) sharedClient = createPrismaClient()
  return sharedClient
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!sharedClient) return
  await sharedClient.$disconnect()
  sharedClient = null
}
