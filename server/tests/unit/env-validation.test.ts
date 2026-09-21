import { describe, expect, it } from 'vitest'
import { EnvSchema } from '../../src/config/env.js'

/**
 * 密钥校验（design.md §13）。
 *
 * 这两条约束挡的是同一类事故：项目自带一份 .env.example，
 * 而示例里的占位值长度足够、照着抄就能启动 —— 启动后签名密钥就是公开常量。
 */

const VALID_JWT = 'unit-test-jwt-secret-0123456789abcdefghijkl'
const VALID_SIGNING = 'unit-test-file-signing-secret-0123456789abcd'

function envWith(overrides: Record<string, string>): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'file:./prisma/test.db',
    JWT_SECRET: VALID_JWT,
    FILE_SIGNING_SECRET: VALID_SIGNING,
    ...overrides,
  }
}

/** 校验失败时的首条错误信息（含字段名），便于断言是哪条规则拦下的 */
function failureOf(overrides: Record<string, string>): string {
  const parsed = EnvSchema.safeParse(envWith(overrides))
  if (parsed.success) return '(通过校验)'
  const issue = parsed.error.issues[0]
  return `${issue?.path.join('.')}: ${issue?.message}`
}

describe('环境变量里的密钥校验', () => {
  it('合法配置可以通过', () => {
    expect(EnvSchema.safeParse(envWith({})).success).toBe(true)
  })

  it('拒绝 .env.example 里的占位值，并给出生成命令', () => {
    const failure = failureOf({
      JWT_SECRET: 'replace-me-generate-with-node-crypto-randomBytes-48-base64url',
    })
    expect(failure).toContain('JWT_SECRET')
    expect(failure).toContain('占位值')
    expect(failure).toContain('randomBytes')
  })

  it('拒绝两把密钥相同的配置', () => {
    const failure = failureOf({ FILE_SIGNING_SECRET: VALID_JWT })
    expect(failure).toContain('FILE_SIGNING_SECRET')
    expect(failure).toContain('不能与 JWT_SECRET 相同')
  })

  it('仍然拒绝过短的密钥', () => {
    expect(failureOf({ JWT_SECRET: 'short-secret' })).toContain('至少 32 个字符')
  })

  it('不会误伤真实密钥：开发与测试环境用的值照常通过', () => {
    // 占位符匹配刻意写窄，就是为了不把这两个真实值一起拒掉 ——
    // 否则本地开发、全部单测与 e2e 都会启动失败。
    expect(
      EnvSchema.safeParse(
        envWith({
          JWT_SECRET: 'dev-only-jwt-secret-do-not-use-in-production-0f3a9c1d7b6e4a52',
          FILE_SIGNING_SECRET: 'dev-only-file-signing-secret-do-not-use-in-prod-8b2e5c4a9f1d6037',
        }),
      ).success,
    ).toBe(true)

    expect(
      EnvSchema.safeParse(
        envWith({
          JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop',
          FILE_SIGNING_SECRET: 'test-file-signing-secret-0123456789abcdef',
        }),
      ).success,
    ).toBe(true)
  })
})
