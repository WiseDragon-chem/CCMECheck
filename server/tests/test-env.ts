import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 测试环境变量。
 *
 * 这个模块**只做副作用**，必须在任何 src/ 模块之前被导入 ——
 * ESM 按导入顺序求值，所以测试文件里要写成：
 *
 *     import './test-env.js'
 *     import { createApp } from '../src/app.js'
 *
 * src/config/env.ts 在 NODE_ENV=test 时会跳过读取 .env，
 * 因此这里设的值就是最终生效的值。
 */

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TEST_DB_FILE = path.join(SERVER_ROOT, 'prisma', 'test.db')
export const TEST_STORAGE_ROOT = path.join(SERVER_ROOT, 'storage-test')
/** 相对于 server/ 的连接串，prisma.config.ts 与 env.ts 都按这个基准解析 */
export const TEST_DATABASE_URL = 'file:./prisma/test.db'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.PUBLIC_BASE_URL = 'http://localhost:3000'
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop'
process.env.FILE_SIGNING_SECRET = 'test-file-signing-secret-0123456789abcdef'
// 访问令牌在测试里给一个很长的有效期。
//
// 截止时间、快照、跨日活动日这些用例都要把时钟往前推几小时甚至几天，
// 若沿用生产的 15 分钟，令牌会在时钟跳变后立刻过期，
// 测试失败现场变成 TOKEN_EXPIRED，掩盖真正要验证的逻辑。
// 令牌有效期本身不是这些用例的验证目标。
process.env.ACCESS_TOKEN_TTL_SECONDS = String(365 * 24 * 60 * 60)
process.env.REFRESH_TOKEN_TTL_DAYS = '30'
process.env.ACTIVATION_TOKEN_TTL_DAYS = '30'
process.env.COOKIE_NAME = 'ccme_refresh'
process.env.STORAGE_ROOT = TEST_STORAGE_ROOT
process.env.CORS_ORIGINS = 'http://localhost:5173'
// 测试里不接受定时任务抢跑：需要时直接调用任务函数
process.env.SCHEDULER_ENABLED = 'false'
// 日志会淹没测试输出
process.env.LOG_LEVEL = 'silent'
