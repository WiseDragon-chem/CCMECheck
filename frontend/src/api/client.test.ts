import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { ApiError, refreshAccessToken, request, setAuthLostHandler } from './client'
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore'

/**
 * 这一组测试守的是全站最容易出微妙错误的地方：401 的分类处理与刷新单飞。
 *
 * 失败模式都是「偶发、无法复现、用户投诉莫名掉线」那一类，
 * 靠手工点击几乎测不出来。
 */

const API = 'http://localhost:3000/api/v1'

let refreshCalls = 0
let requestCalls = 0
/** 每个用例自行决定 /auth/refresh 返回成功还是 401 */
let refreshBehaviour: () => Response = () =>
  HttpResponse.json({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 900, user: {} })

const server = setupServer(
  http.post(`${API}/auth/refresh`, () => {
    refreshCalls += 1
    return refreshBehaviour()
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

beforeEach(() => {
  refreshCalls = 0
  requestCalls = 0
  refreshBehaviour = () =>
    HttpResponse.json({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 900, user: {} })
  clearAccessToken()
  // 清掉跨标签页去重用的时间戳，否则「刚刷过」的判断会跳过真正的刷新
  window.localStorage.clear()
  setAuthLostHandler(null)
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

function errorResponse(code: string, status = 401) {
  return HttpResponse.json(
    { code, message: `模拟错误 ${code}`, request_id: 'req_test', details: {} },
    { status },
  )
}

/** 造一个「首次 401，重放后成功」的受保护接口 */
function guardedEndpoint(options: { failFirstWith: string; succeeding: unknown }) {
  let calls = 0
  server.use(
    http.get(`${API}/campaigns/current`, ({ request: req }) => {
      calls += 1
      requestCalls += 1
      const auth = req.headers.get('authorization')
      if (calls === 1) return errorResponse(options.failFirstWith)
      return HttpResponse.json({ ...(options.succeeding as object), _auth: auth })
    }),
  )
  return () => calls
}

describe('401 的分类处理', () => {
  it('TOKEN_EXPIRED：刷新一次后重放原请求', async () => {
    setAccessToken('stale-token', 900)
    const calls = guardedEndpoint({ failFirstWith: 'TOKEN_EXPIRED', succeeding: { campaign: { id: 'c1' } } })

    const result = await request<{ campaign: { id: string }; _auth: string }>('/campaigns/current')

    expect(calls()).toBe(2)
    expect(refreshCalls).toBe(1)
    expect(result.campaign.id).toBe('c1')
    // 重放用的是刷新后的新令牌
    expect(result._auth).toBe('Bearer fresh-token')
  })

  it('并发多个 401 只触发一次刷新（单飞）', async () => {
    setAccessToken('stale-token', 900)

    // 三个接口各自「首次 401、重放成功」
    for (const path of ['/checkins/today', '/checkins', '/leaderboards/latest']) {
      let calls = 0
      server.use(
        http.get(`${API}${path}`, () => {
          calls += 1
          if (calls === 1) return errorResponse('TOKEN_EXPIRED')
          return HttpResponse.json({ ok: true, path })
        }),
      )
    }

    const results = await Promise.all([
      request<{ ok: boolean; path: string }>('/checkins/today'),
      request<{ ok: boolean; path: string }>('/checkins'),
      request<{ ok: boolean; path: string }>('/leaderboards/latest'),
    ])

    // 关键断言：三次 401 只换来一次刷新。
    // 若各自刷新，后到的会拿着已被轮换掉的旧刷新令牌去换而失败，把用户踢下线。
    expect(refreshCalls).toBe(1)
    expect(results.map((r) => r.path)).toEqual(['/checkins/today', '/checkins', '/leaderboards/latest'])
  })

  it('TOKEN_INVALID：不刷新，直接判定会话失效', async () => {
    setAccessToken('stale-token', 900)
    const lost = vi.fn()
    setAuthLostHandler(lost)

    server.use(
      http.get(`${API}/checkins/today`, () => errorResponse('TOKEN_INVALID')),
    )

    await expect(request('/checkins/today')).rejects.toBeInstanceOf(ApiError)
    // 刷新也拿不到有效令牌，重试只会陷入死循环
    expect(refreshCalls).toBe(0)
    expect(lost).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('ACCOUNT_DISABLED：不刷新，判定为终止态', async () => {
    setAccessToken('stale-token', 900)
    const lost = vi.fn()
    setAuthLostHandler(lost)

    server.use(http.get(`${API}/checkins/today`, () => errorResponse('ACCOUNT_DISABLED')))
    await expect(request('/checkins/today')).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' })

    expect(refreshCalls).toBe(0)
    expect(lost).toHaveBeenCalledTimes(1)
  })

  it('REAUTH_REQUIRED：本次请求已经重放过，仍会被再重放一次而不是直接报错', async () => {
    setAccessToken('stale-token', 900)
    const lost = vi.fn()
    setAuthLostHandler(lost)

    // 第一次 401 TOKEN_EXPIRED 触发刷新与重放，
    // 重放时又收到 REAUTH_REQUIRED —— 此时若受「已重放过」的常规配额限制，
    // 就会把一次本可自愈的敏感操作变成用户可见的错误。
    let calls = 0
    server.use(
      http.get(`${API}/admin/campaign`, () => {
        calls += 1
        if (calls === 1) return errorResponse('TOKEN_EXPIRED')
        if (calls === 2) return errorResponse('REAUTH_REQUIRED')
        return HttpResponse.json({ ok: true })
      }),
    )

    const result = await request<{ ok: boolean }>('/admin/campaign')

    expect(result.ok).toBe(true)
    // 三次调用 = 初次 + 令牌过期后重放 + 强制刷新后重放
    expect(calls).toBe(3)
    expect(lost).not.toHaveBeenCalled()
    // 是否真的发生了第二次网络刷新取决于去重（见下一个用例），这里只要求发生过刷新
    expect(refreshCalls).toBeGreaterThanOrEqual(1)
  })

  it('刚刷新过的令牌会被复用，不做无谓轮换', async () => {
    setAccessToken('stale-token', 900)
    await refreshAccessToken()
    expect(refreshCalls).toBe(1)

    // 刷新令牌每次轮换，短时间内重复刷新既浪费又会在多标签页下互相踢下线。
    // 上一次刷新刚拿到的令牌 iat 本来就是新鲜的，直接复用即可。
    const token = await refreshAccessToken()
    expect(refreshCalls).toBe(1)
    expect(token).toBe('fresh-token')
  })

  it('刷新本身失败时，向上抛出原始错误并通知会话失效', async () => {
    setAccessToken('stale-token', 900)
    const lost = vi.fn()
    setAuthLostHandler(lost)
    refreshBehaviour = () => errorResponse('TOKEN_INVALID')

    server.use(http.get(`${API}/checkins/today`, () => errorResponse('TOKEN_EXPIRED')))

    await expect(request('/checkins/today')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    expect(refreshCalls).toBe(1)
    expect(lost).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('非 401 的错误不会被误当成令牌问题', async () => {
    setAccessToken('good-token', 900)
    server.use(
      http.get(`${API}/checkins/today`, () =>
        HttpResponse.json(
          { code: 'CHECKIN_CLOSED', message: '已截止', request_id: 'req_1', details: {} },
          { status: 409 },
        ),
      ),
    )

    await expect(request('/checkins/today')).rejects.toMatchObject({ code: 'CHECKIN_CLOSED', status: 409 })
    expect(refreshCalls).toBe(0)
  })
})

describe('请求头', () => {
  it('刷新请求自身不带 Authorization（它靠 Cookie）', async () => {
    setAccessToken('stale-token', 900)
    const seen: Array<string | null> = []
    server.use(
      http.post(`${API}/auth/refresh`, ({ request: req }) => {
        seen.push(req.headers.get('authorization'))
        refreshCalls += 1
        return HttpResponse.json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 900, user: {} })
      }),
    )

    await refreshAccessToken()
    expect(seen).toEqual([null])
  })

  it('匿名接口不带 Authorization', async () => {
    setAccessToken('stale-token', 900)
    let auth: string | null = 'unset'
    server.use(
      http.post(`${API}/auth/login`, ({ request: req }) => {
        auth = req.headers.get('authorization')
        return HttpResponse.json({ user: {}, access_token: 't', token_type: 'Bearer', expires_in: 900 })
      }),
    )

    await request('/auth/login', { method: 'POST', body: { student_id: 'x', password: 'y' } })
    expect(auth).toBeNull()
  })

  it('受保护接口带上 Authorization', async () => {
    setAccessToken('good-token', 900)
    let auth: string | null = null
    server.use(
      http.get(`${API}/users/me`, ({ request: req }) => {
        auth = req.headers.get('authorization')
        return HttpResponse.json({ user: { id: 'u1' } })
      }),
    )

    await request('/users/me')
    expect(auth).toBe('Bearer good-token')
  })
})
