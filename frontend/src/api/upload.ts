import { API_BASE_URL } from '@/config/env'
import { zh } from '@/locales/zh-CN'
import { ApiError, notifyAuthLost, refreshAccessToken } from './client'
import { getAccessToken } from './tokenStore'
import type { ErrorCode, SubmitCheckinResult } from './types'

/**
 * 打卡提交。
 *
 * 这是全站**唯一**用 XMLHttpRequest 的地方 —— `fetch` 拿不到
 * `upload.onprogress`，而 design.md §7.4 要求显示上传进度，
 * §15 也要求「显示实时进度，并允许失败后重新上传」。
 * 三张图在手机网络下要几十秒，没有进度条用户会以为卡死了。
 *
 * 错误处理与 api/client.ts 共用同一套语义（错误信封 → ApiError，
 * 401 分类处理），只是传输层不同。
 */

export interface SubmitCheckinInput {
  track: string
  activityDate: string
  note: string | null
  /** 幂等键。每次提交动作重新生成 —— 固定值会让第二次提交被当成重复而静默返回旧版本 */
  clientToken: string
  /** 顺序即服务端的 sort_order，调用方要保证它等于界面上的展示顺序 */
  images: File[]
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export function submitCheckin(input: SubmitCheckinInput): Promise<SubmitCheckinResult> {
  return uploadWithProgress(input, false)
}

/**
 * 构造提交用的 FormData。
 *
 * 抽成纯函数是为了能被单独测试 —— 这里的顺序**就是**服务端的 sort_order：
 * 后端按 `images` 字段的出现顺序写下标。搞错了不会有任何报错，
 * 只会让用户看到图片顺序与自己的排列不一致。
 */
export function buildCheckinFormData(input: Omit<SubmitCheckinInput, 'onProgress' | 'signal'>): FormData {
  const form = new FormData()
  form.append('track', input.track)
  form.append('activity_date', input.activityDate)
  form.append('client_token', input.clientToken)
  if (input.note) form.append('note', input.note)

  // 用 for 循环而不是 forEach，是为了让「顺序即指标」这件事显式可见
  for (let index = 0; index < input.images.length; index += 1) {
    const file = input.images[index]
    if (file) form.append('images', file, file.name)
  }

  return form
}

async function uploadWithProgress(
  input: SubmitCheckinInput,
  alreadyRetried: boolean,
): Promise<SubmitCheckinResult> {
  const form = buildCheckinFormData(input)

  const result = await new Promise<SubmitCheckinResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/checkins`)
    // 刷新令牌走 Cookie
    xhr.withCredentials = true

    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    if (input.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        // 只报到 99：剩下 1% 留给服务端的图片处理（解码、剥 EXIF、重编码），
        // 否则进度条会停在 100% 而请求还没回来，看起来像卡住了
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100))
        input.onProgress?.(percent)
      }
    }

    xhr.onload = () => {
      const body = safeParse(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(100)
        resolve(body as SubmitCheckinResult)
        return
      }
      reject(
        new ApiError({
          code: (body?.code as ErrorCode | undefined) ?? 'UNKNOWN',
          status: xhr.status,
          message: body?.message ?? zh.upload.failed(xhr.status),
          requestId: body?.request_id,
          details: body?.details,
        }),
      )
    }

    xhr.onerror = () =>
      reject(new ApiError({ code: 'UNKNOWN', status: 0, message: zh.upload.networkError }))

    xhr.ontimeout = () =>
      reject(new ApiError({ code: 'UNKNOWN', status: 0, message: zh.upload.timeout }))

    xhr.onabort = () =>
      reject(new ApiError({ code: 'UNKNOWN', status: 0, message: zh.upload.aborted }))

    input.signal?.addEventListener('abort', () => xhr.abort(), { once: true })

    xhr.send(form)
  }).catch(async (error: unknown) => {
    // 令牌过期时重放一次。上传通常耗时较长，中途过期并不罕见。
    if (
      !alreadyRetried &&
      error instanceof ApiError &&
      error.status === 401 &&
      (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHENTICATED')
    ) {
      try {
        await refreshAccessToken()
      } catch {
        notifyAuthLost(error)
        throw error
      }
      return uploadWithProgress(input, true)
    }

    if (error instanceof ApiError && error.status === 401) notifyAuthLost(error)
    throw error
  })

  return result
}

function safeParse(text: string): (Partial<SubmitCheckinResult> & {
  code?: string
  message?: string
  request_id?: string
  details?: Record<string, unknown>
}) | null {
  try {
    return JSON.parse(text) as never
  } catch {
    return null
  }
}
