import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** server/ 目录的绝对路径，用于解析相对配置（数据库文件、存储目录等） */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Node 内置的 .env 读取，不引入 dotenv 依赖。
//
// 测试环境跳过这一步：测试必须在自己的 setup 里决定数据库与存储目录，
// 若先读了 .env，开发库的连接串就会覆盖测试库，表现为「测试跑在开发数据上」。
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile(path.join(SERVER_ROOT, '.env'))
  } catch {
    // 没有 .env 文件，使用进程已有的环境变量
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.url(),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 个字符'),
  FILE_SIGNING_SECRET: z.string().min(32, 'FILE_SIGNING_SECRET 至少 32 个字符'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ACTIVATION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_NAME: z.string().default('ccme_refresh'),

  CORS_ORIGINS: z.string().default(''),

  STORAGE_ROOT: z.string().default('./storage'),

  /** 数据库备份目录。必须是本地磁盘，不能是同步盘。 */
  BACKUP_ROOT: z.string().default('./backups'),
  /** 备份保留时长（天），超出的会被清理任务删除 */
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** 设为 false 可关闭进程内定时任务（测试与本地调试用） */
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  SEED_ADMIN_STUDENT_ID: z.string().default('admin'),
  SEED_ADMIN_NAME: z.string().default('系统管理员'),
  SEED_ADMIN_PASSWORD: z.string().optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  throw new Error(`环境变量校验失败，请检查 .env（参考 .env.example）：\n${issues}`)
}

const raw = parsed.data

/**
 * 把 `file:./prisma/dev.db` 这类相对连接串解析成绝对文件路径。
 * better-sqlite3 直接接收文件路径，不需要 URI 前缀。
 */
function resolveDatabaseFile(databaseUrl: string): string {
  const withoutScheme = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl
  if (withoutScheme === ':memory:' || withoutScheme.startsWith('file::memory:')) return ':memory:'
  if (path.isAbsolute(withoutScheme)) return withoutScheme
  return path.resolve(SERVER_ROOT, withoutScheme)
}

function resolveStorageRoot(storageRoot: string): string {
  return path.isAbsolute(storageRoot) ? storageRoot : path.resolve(SERVER_ROOT, storageRoot)
}

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',

  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  publicBaseUrl: raw.PUBLIC_BASE_URL.replace(/\/+$/, ''),

  databaseUrl: raw.DATABASE_URL,
  databaseFile: resolveDatabaseFile(raw.DATABASE_URL),

  jwtSecret: raw.JWT_SECRET,
  fileSigningSecret: raw.FILE_SIGNING_SECRET,

  accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
  activationTokenTtlDays: raw.ACTIVATION_TOKEN_TTL_DAYS,

  cookieDomain: raw.COOKIE_DOMAIN && raw.COOKIE_DOMAIN.length > 0 ? raw.COOKIE_DOMAIN : undefined,
  cookieName: raw.COOKIE_NAME,

  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),

  storageRoot: resolveStorageRoot(raw.STORAGE_ROOT),
  backupRoot: resolveStorageRoot(raw.BACKUP_ROOT),
  backupRetentionDays: raw.BACKUP_RETENTION_DAYS,
  schedulerEnabled: raw.SCHEDULER_ENABLED,

  seedAdmin: {
    studentId: raw.SEED_ADMIN_STUDENT_ID,
    name: raw.SEED_ADMIN_NAME,
    password: raw.SEED_ADMIN_PASSWORD && raw.SEED_ADMIN_PASSWORD.length > 0 ? raw.SEED_ADMIN_PASSWORD : undefined,
  },
} as const
