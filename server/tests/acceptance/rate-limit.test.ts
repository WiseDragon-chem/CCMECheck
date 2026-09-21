import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api } from '../helpers/app.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'

/**
 * 登录/激活限流的键（design.md §7.2）。
 *
 * 这两个用例守的是同一处回归：限流器曾经用 `req.body.studentId` 取值，
 * 而契约字段是 snake_case 的 `student_id`，于是键里永远没有学号 ——
 * 双维度退化成纯 IP。叠加当时默认开启的 trust proxy，客户端换一个
 * X-Forwarded-For 就能拿到一个全新的计数桶，限流等于不存在。
 *
 * 注意：限流器的计数器是模块级单例（内存 Store），跨用例不会自动清空，
 * 所以每个用例都必须使用别人没用过的学号。
 */

/** 失败的登录（401）会被计入限流；成功登录因 skipSuccessfulRequests 不计 */
async function failedLogin(studentId: string, forwardedFor?: string) {
  const request = api().post('/api/v1/auth/login')
  if (forwardedFor) request.set('X-Forwarded-For', forwardedFor)
  return request.send({ student_id: studentId, password: 'WrongPassword1' })
}

describe('登录限流的键', () => {
  beforeEach(() => {
    freezeTimeAt(cst('2026-10-01T10:00:00'))
  })

  afterEach(() => {
    unfreezeTime()
  })

  it('§7.2 不同学号各自计数，不共享同一份额度', async () => {
    // 若键退化成「仅 IP」，第 11 个学号就会因为前面 10 次失败而拿到 429
    const statuses: number[] = []
    for (let index = 0; index < 12; index += 1) {
      const response = await failedLogin(`rl-key-${index}`)
      statuses.push(response.status)
    }

    expect(statuses).toEqual(statuses.map(() => 401))
  })

  it('§7.2 伪造 X-Forwarded-For 不能换取新的计数桶', async () => {
    // 默认不信任代理头（TRUST_PROXY=false），req.ip 取 socket 地址，
    // 因此这 12 次仍然落在同一个桶里：第 11 次起必须是 429
    const statuses: number[] = []
    for (let index = 0; index < 12; index += 1) {
      const response = await failedLogin('rl-xff-fixed', `203.0.113.${index}`)
      statuses.push(response.status)
    }

    expect(statuses).toContain(429)
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })
})
