import { describe, expect, it } from 'vitest'
import { ERROR_HANDLING, UNKNOWN_ERROR_TEXT, fieldErrorsFrom, handlingFor } from './errorMessages'

describe('错误码映射', () => {
  it('每个错误码都有处理方式，没有遗漏', () => {
    // ERROR_HANDLING 的类型是 Record<ErrorCode, …> 且 ErrorCode 来自 OpenAPI 契约，
    // 所以「漏了一个」本就会编译失败；这条运行时断言是为了让契约漂移时
    // 测试也报错，而不只是构建报错。
    const codes = Object.keys(ERROR_HANDLING)
    expect(codes.length).toBeGreaterThan(25)
    for (const code of codes) {
      expect(ERROR_HANDLING[code as keyof typeof ERROR_HANDLING].surface).toBeTruthy()
    }
  })

  it('令牌类错误交给拦截器静默处理，不打扰用户', () => {
    expect(handlingFor('TOKEN_EXPIRED').surface).toBe('silent')
    expect(handlingFor('UNAUTHENTICATED').surface).toBe('silent')
    expect(handlingFor('REAUTH_REQUIRED').surface).toBe('silent')
  })

  it('会话彻底失效是不可继续的，要清状态回登录页', () => {
    for (const code of ['TOKEN_INVALID', 'ACCOUNT_DISABLED', 'ACCOUNT_NOT_ACTIVATED'] as const) {
      expect(handlingFor(code).surface, code).toBe('fatal')
    }
  })

  it('重复提交当作成功处理，不弹错误', () => {
    // 重复点击是预期行为，把它渲染成红色错误会让用户以为打卡失败了
    expect(handlingFor('DUPLICATE_SUBMISSION').surface).toBe('silent')
    expect(handlingFor('DUPLICATE_RECORD').surface).toBe('silent')
  })

  it('参数校验错误落到表单字段上', () => {
    expect(handlingFor('VALIDATION_FAILED').surface).toBe('inline')
  })

  it('服务端错误带上 request_id，那是与日志对照的唯一线索', () => {
    expect(handlingFor('INTERNAL_ERROR').showRequestId).toBe(true)
  })

  it('未映射的 code 走兜底而不是崩溃', () => {
    // 契约漂移、网关插话等情况
    const unknown = handlingFor('NOT_A_REAL_CODE' as never)
    expect(unknown.surface).toBe('toast')
    expect(unknown.text).toBe(UNKNOWN_ERROR_TEXT)
  })

  it('undefined 同样走兜底', () => {
    expect(handlingFor(undefined).text).toBe(UNKNOWN_ERROR_TEXT)
  })

  it('打卡相关错误保留服务端的中文措辞', () => {
    // 这些文案服务端写得比前端更准（含具体截止时间等上下文），不覆盖
    expect(handlingFor('CHECKIN_CLOSED').text).toBe('该活动日的打卡已经截止')
    expect(handlingFor('CHECKIN_ALREADY_APPROVED').text).toContain('管理员')
  })
})

describe('字段错误提取', () => {
  it('从 details.fields 还原成表单可用的结构', () => {
    const fields = fieldErrorsFrom({
      fields: [
        { field: 'password', message: '密码至少 8 位' },
        { field: 'student_id', message: '请填写学号' },
      ],
    })
    expect(fields).toEqual([
      { field: 'password', message: '密码至少 8 位' },
      { field: 'student_id', message: '请填写学号' },
    ])
  })

  it('结构不对时返回空数组而不是抛错', () => {
    expect(fieldErrorsFrom(undefined)).toEqual([])
    expect(fieldErrorsFrom({})).toEqual([])
    expect(fieldErrorsFrom({ fields: 'not-an-array' })).toEqual([])
    expect(fieldErrorsFrom({ fields: [null, 1, { field: 1 }, { field: 'a' }] })).toEqual([])
  })

  it('忽略缺字段或消息的条目，保留其余', () => {
    const fields = fieldErrorsFrom({
      fields: [{ field: 'name', message: '必填' }, { field: 'x' }, { message: 'y' }],
    })
    expect(fields).toEqual([{ field: 'name', message: '必填' }])
  })
})
