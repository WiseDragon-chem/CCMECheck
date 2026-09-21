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

/**
 * .env.example 里的示例值必须被拒。
 *
 * 那些占位值长度都超过 32，能顺利通过长度校验 —— 照抄示例启动之后，
 * 两把密钥就是人人可查的公开常量：FILE_SIGNING_SECRET 泄漏可以给任意 assetId
 * 伪造长期有效的图片地址，JWT_SECRET 泄漏可以伪造任意已知用户的访问令牌。
 *
 * 匹配刻意写得很窄：开发用的 `dev-only-…-do-not-use-in-production-…` 与
 * 测试用的 `test-jwt-secret-…` 都不含这些字样，不会被误伤。
 */
const PLACEHOLDER_SECRET_PATTERNS = [/^replace-me/i, /^change-me/i, /^your[-_]/i, /placeholder/i]

function signingSecretSchema(name: string) {
  const hint =
    `请生成一个随机密钥：node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
  return z
    .string()
    .min(32, `${name} 至少 32 个字符`)
    .refine((value) => !PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(value)), {
      message: `${name} 仍是 .env.example 里的占位值，${hint}`,
    })
}

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.url(),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: signingSecretSchema('JWT_SECRET'),
  FILE_SIGNING_SECRET: signingSecretSchema('FILE_SIGNING_SECRET'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ACTIVATION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_NAME: z.string().default('ccme_refresh'),

  CORS_ORIGINS: z.string().default(''),

  /**
   * Express 的 trust proxy 设置，取值 true / false / 非负整数（代理跳数）。
   *
   * 默认 false —— 用 socket 地址而不是 X-Forwarded-For。限流的键与 audit_logs.ip
   * 都取自 req.ip，直连时信任代理头等于让调用方自己申报 IP，限流可被绕过。
   * 只有确实部署在可信反向代理之后才设置，并且必须由该代理覆写请求头。
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .refine((value) => value === 'true' || value === 'false' || /^\d+$/.test(value), {
      message: 'TRUST_PROXY 只能是 true、false 或非负整数（代理跳数）',
    }),

  STORAGE_ROOT: z.string().default('./storage'),

  /** 数据库备份目录。必须是本地磁盘，不能是同步盘。 */
  BACKUP_ROOT: z.string().default('./backups'),
  /** 备份保留时长（天），超出的会被清理任务删除 */
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * 证明材料在活动结束后的保留天数（design.md §18.8）。
   *
   * **0 表示永不自动删除**，这也是默认值 —— 自动删除用户上传的材料
   * 属于不可逆的破坏性操作，必须由组织者显式开启，不能靠默认值生效。
   */
  EVIDENCE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),

  /** 设为 false 可关闭进程内定时任务（测试与本地调试用） */
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  SEED_ADMIN_STUDENT_ID: z.string().default('admin'),
  SEED_ADMIN_NAME: z.string().default('系统管理员'),
  SEED_ADMIN_PASSWORD: z.string().optional(),

  /**
   * 审核员账号。设计文档 §5 要求超管能管理管理员账号，
   * 但那套接口尚不存在 —— 在那之前，审核员只能由种子脚本创建。
   *
   * 这不是可选项：没有审核员，系统上线后没人能审材料，
   * §16 的整条审核链路都跑不起来。
   */
  SEED_REVIEWER_STUDENT_ID: z.string().default('reviewer'),
  SEED_REVIEWER_NAME: z.string().default('审核员'),
  SEED_REVIEWER_PASSWORD: z.string().optional(),
}).refine((value) => value.JWT_SECRET !== value.FILE_SIGNING_SECRET, {
  // 两把密钥用途不同（访问令牌 / 图片签名），复用等于让一处泄漏连带另一处：
  // 图片签名密钥出现在每个签名地址的校验路径上，暴露面更大。
  path: ['FILE_SIGNING_SECRET'],
  message: 'FILE_SIGNING_SECRET 不能与 JWT_SECRET 相同，请分别随机生成',
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

  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  publicBaseUrl: raw.PUBLIC_BASE_URL.replace(/\/+$/, ''),

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

  trustProxy:
    raw.TRUST_PROXY === 'true' ? true : raw.TRUST_PROXY === 'false' ? false : Number(raw.TRUST_PROXY),

  storageRoot: resolveStorageRoot(raw.STORAGE_ROOT),
  backupRoot: resolveStorageRoot(raw.BACKUP_ROOT),
  backupRetentionDays: raw.BACKUP_RETENTION_DAYS,
  evidenceRetentionDays: raw.EVIDENCE_RETENTION_DAYS,
  schedulerEnabled: raw.SCHEDULER_ENABLED,

  seedAdmin: {
    studentId: raw.SEED_ADMIN_STUDENT_ID,
    name: raw.SEED_ADMIN_NAME,
    password: raw.SEED_ADMIN_PASSWORD && raw.SEED_ADMIN_PASSWORD.length > 0 ? raw.SEED_ADMIN_PASSWORD : undefined,
  },

  seedReviewer: {
    studentId: raw.SEED_REVIEWER_STUDENT_ID,
    name: raw.SEED_REVIEWER_NAME,
    password:
      raw.SEED_REVIEWER_PASSWORD && raw.SEED_REVIEWER_PASSWORD.length > 0
        ? raw.SEED_REVIEWER_PASSWORD
        : undefined,
  },
} as const
