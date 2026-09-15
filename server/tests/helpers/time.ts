import { vi } from 'vitest'

/**
 * 冻结「服务器现在几点」。
 *
 * 两个参数都是必需的，各修一个坑：
 *
 * 1) 用完整假计时器，而不是 toFake: ['Date']。
 *    后者在 vitest 5 下会让 new Date() 返回 Invalid Date，
 *    表现为 Prisma 写库时报 "RangeError: Invalid time value"。
 *
 * 2) 必须带 shouldAdvanceTime: true。
 *    supertest 驱动的 HTTP 请求在计时器被冻死的情况下会永久挂起 ——
 *    请求本身依赖某个 setTimeout 才能推进，而假计时器不会自己走。
 *    加上它之后，假时钟按真实时间自行前进，请求正常返回，
 *    同时 setSystemTime 设定的基准点依然生效。
 *
 * 代价是「冻结」的时间会以真实速度漂移。测试里因此不要依赖秒级精度：
 * 判断截止边界时留出足够余量（例如用整分钟而不是 23:59:59）。
 */
export function freezeTimeAt(instant: Date | string): void {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(typeof instant === 'string' ? new Date(instant) : instant)
}

export function unfreezeTime(): void {
  vi.useRealTimers()
}

/**
 * 构造一个北京时间的瞬时，避免测试里到处写 +08:00。
 *
 *   cst('2026-10-01')                  → 2026-10-01 10:00:00 +08:00
 *   cst('2026-10-01', '23:00:00')      → 2026-10-01 23:00:00 +08:00
 *   cst('2026-10-01T23:00:00')         → 同上
 *
 * 两种写法都接受：一开始只支持前一种，测试里混用后一种会拼出
 * 2026-10-01T10:00:00T10:00:00+08:00 这种非法字符串，而失败现场是
 * Prisma 报 RangeError，排查成本很高。
 */
export function cst(date: string, time = '10:00:00'): Date {
  const iso = date.includes('T') ? date : `${date}T${time}`
  return new Date(`${iso}+08:00`)
}
