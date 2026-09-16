import { requestRaw } from '@/api/client'

/**
 * 带鉴权的文件下载。
 *
 * 导出接口（§8.3 的参赛者名册、§12.4 的打卡明细与排行榜）都挂在鉴权之后，
 * 而 `<a href>` 带不上 Bearer 令牌 —— 所以不能像普通下载那样给个链接，
 * 必须自己取字节、自己造一个 `<a download>`。
 *
 * 走 `requestRaw` 而不是裸 `fetch`：下载也要能在令牌过期后自动刷新重放，
 * 这条逻辑只应该有一份（见 api/client.ts 的说明）。
 */

/**
 * 从 Content-Disposition 里取文件名。
 *
 * 后端两个都给了：`filename="export.csv"` 是 ASCII 回退，
 * `filename*=UTF-8''%E2%80%A6` 是 RFC 5987 形式，可以带中文（活动名）。
 * 优先用后者 —— 回退名对所有导出都是同一个 `export.csv`，
 * 管理员连下三个导出就会得到「export (1).csv」「export (2).csv」。
 *
 * 抽成纯函数是为了能单独测：这段解析错了不会报错，只会把文件存成
 * 一个莫名其妙的名字，而那种问题没人会去查。
 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback

  // filename*=UTF-8''xxx 优先。语言标签可能不是 UTF-8（少见），一律按 UTF-8 解
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (extended?.[1]) {
    const value = extended[1].trim().replace(/^["']|["']$/g, '')
    const encoded = value.includes("''") ? value.slice(value.indexOf("''") + 2) : value
    try {
      return safeName(decodeURIComponent(encoded))
    } catch {
      // 百分号编码坏了就退回普通文件名，不要因为一个响应头而让整个导出失败
    }
  }

  const plain = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(header)
  const raw = plain?.[2] ?? plain?.[3]
  if (raw) return safeName(raw.trim())

  return fallback
}

/**
 * 去掉路径分隔符与控制字符。
 *
 * 文件名来自服务端，正常情况下是干净的；但这个值会直接进入
 * `<a download>`，而带 `/` 的名字在某些浏览器上会被当成路径，
 * 控制字符则会让 download 属性被静默忽略。
 * 这不是在防攻击面 —— 是不让一次普通的导出因为活动名里有个斜杠而失败。
 */
function safeName(name: string): string {
  // \p{Cc} 是 Unicode 的「控制字符」类别，比逐个列出码位更清楚；
  // 而正则里直接写控制字符会被 no-control-regex 规则拦下
  const cleaned = name
    .replace(/[/\\]/g, '_')
    .replace(/\p{Cc}/gu, '')
    .trim()
  return cleaned || 'export.csv'
}

/** 就地把字节落盘。`<a download>` 是唯一不依赖用户手动点链接的写法 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻回收：这个 URL 已经交给浏览器了，留着只是占内存
  URL.revokeObjectURL(url)
}

/** 下载一个 CSV。失败时抛 ApiError，由调用方按 `presentError` 处理 */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const response = await requestRaw(path)
  const blob = await response.blob()
  saveBlob(blob, filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName))
}

/** 把一段文本当 CSV 存下来（用于把一次性返回的明文数据交给管理员带走） */
export function saveTextAsFile(text: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  saveBlob(new Blob([text], { type: mime }), filename)
}
