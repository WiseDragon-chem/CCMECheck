import { Algorithm, hash, hashSync, verify } from '@node-rs/argon2'
import { randomToken } from './crypto.js'

/**
 * design.md §13 要求密码使用 Argon2id。
 * 参数采用 OWASP 推荐值：19 MiB 内存、2 次迭代、单线程。
 * 选 @node-rs/argon2 而非 argon2/bcrypt，是因为它在 Windows 上走 N-API 预编译产物，
 * 不需要 node-gyp 构建链。
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS)
}

export async function verifyPassword(hashed: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashed, plaintext, ARGON2_OPTIONS)
  } catch {
    // 哈希串格式非法（例如脏数据）视为校验失败，而不是抛错泄漏细节
    return false
  }
}

let dummyHash: string | null = null

/**
 * 一个用真实参数算出来的哈希，供「账号不存在」分支消耗等量校验时间，
 * 避免通过响应耗时枚举出哪些学号已注册。
 * 惰性计算，避免每个进程启动都白白付出一次哈希开销。
 */
export function getDummyPasswordHash(): string {
  if (!dummyHash) dummyHash = hashSync(randomToken(16), ARGON2_OPTIONS)
  return dummyHash
}

export interface PasswordPolicyResult {
  ok: boolean
  message?: string
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` }
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `密码不能超过 ${PASSWORD_MAX_LENGTH} 位` }
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, message: '密码需要同时包含字母和数字' }
  }
  return { ok: true }
}
