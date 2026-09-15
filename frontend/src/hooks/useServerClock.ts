import { useEffect, useState } from 'react'

/**
 * 服务器时钟。
 *
 * design.md §7.3 明确：倒计时只用于提示，**服务器时间负责最终判定**。
 * 设备时钟可能偏差很大（也有用户会手动改），所以本地只负责
 * 「从服务器给的那一刻起往前数」，基准永远来自响应里的 server_time。
 */

let offsetMs = 0

/** 每次拿到带 server_time 的响应就同步一次 */
export function syncServerClock(serverTimeIso: string | undefined): void {
  if (!serverTimeIso) return
  const parsed = Date.parse(serverTimeIso)
  if (Number.isNaN(parsed)) return
  offsetMs = parsed - Date.now()
}

/** 校正后的当前时间 */
export function serverNow(): number {
  return Date.now() + offsetMs
}

export function clockOffsetMs(): number {
  return offsetMs
}

/** 仅测试用：重置偏移 */
export function __resetServerClock(): void {
  offsetMs = 0
}

/**
 * 每秒触发一次重渲染，用于倒计时这类需要持续更新的展示。
 *
 * 刻意不返回 Date 对象：调用方要的是「每秒重算一次」这个节拍，
 * 具体时间用 serverNow() 取，避免把两个概念混在一起。
 */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return tick
}
