/**
 * 铁律三：积分一律是整数毫点（1000 = 1 分）。
 *
 * 后端刻意用整数存积分、用整数千分比存权重，是为了让「同分并列」的判定
 * 可复现（浮点尾差会让名次在两次计算之间漂移，见 server/README 第 1 节）。
 * 前端必须配合：**只做展示，不做运算**。
 *
 * 页面上的积分格式化只有 formatMilli 一个入口，
 * 因此在任何地方看到 `score / 1000` 都应当被当成 bug。
 */

/** 整数毫点 → 展示字符串，去掉多余的零：1500 → "1.5"，2000 → "2" */
export function formatMilli(milli: number): string {
  const sign = milli < 0 ? '-' : ''
  const abs = Math.abs(milli)
  const whole = Math.floor(abs / 1000)
  const fraction = abs % 1000
  if (fraction === 0) return `${sign}${whole}`
  // 最多三位小数，去掉尾随的零
  const fractionText = String(fraction).padStart(3, '0').replace(/0+$/, '')
  return `${sign}${whole}.${fractionText}`
}

/** 展示字符串 → 整数毫点。管理端编辑分值时用。 */
export function parsePointsToMilli(input: string | number): number {
  const value = typeof input === 'number' ? input : Number(input.trim())
  if (!Number.isFinite(value)) throw new Error(`不是合法的分值：${input}`)
  return Math.round(value * 1000)
}

/**
 * 排行榜用的展示值。
 *
 * 契约里 `score` 是后端已经除好的展示值、`score_milli` 是精确整数。
 * 展示用前者，比较或排序用后者。
 */
export function formatScore(score: number): string {
  return String(Math.round(score * 1000) / 1000)
}
