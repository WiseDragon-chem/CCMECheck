import supertest from 'supertest'
import { createApp } from '../../src/app.js'

/** 整个测试套件共用一个 Express 实例，避免每个用例重复装配中间件 */
export const app = createApp()

export function api() {
  return supertest(app)
}

export interface AuthSession {
  accessToken: string
  userId: string
  studentId: string
  cookies: string[]
}

/** 登录并返回访问令牌与 Cookie，供后续请求复用 */
export async function login(studentId: string, password: string): Promise<AuthSession> {
  // 请求体字段是 snake_case（与其余所有模块一致），这里是本地形参到线上字段的映射
  const response = await api().post('/api/v1/auth/login').send({ student_id: studentId, password })

  if (response.status !== 200) {
    throw new Error(`登录失败（${response.status}）：${JSON.stringify(response.body)}`)
  }

  return {
    accessToken: response.body.access_token as string,
    userId: response.body.user.id as string,
    studentId,
    // supertest 的类型把 set-cookie 标成 string | string[]，实际始终是数组
    cookies: ([] as string[]).concat(response.headers['set-cookie'] ?? []),
  }
}

/** 带 Bearer 令牌的请求 */
export function authed(token: string) {
  return {
    get: (url: string) => api().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => api().post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => api().put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => api().patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => api().delete(url).set('Authorization', `Bearer ${token}`),
  }
}
