import { useEffect, useState } from 'react'

/**
 * 本地倒计时。
 *
 * 服务端给的 `seconds_until_next_update` 是**响应生成那一刻**的剩余秒数。
 * 直接把它显示出来，页面开着十分钟它就还是十分钟前的那个数 ——
 * 「距下次排行榜更新 3 小时 12 分」会一直停在那里，而管理员正盯着它
 * 决定要不要再等一轮。
 *
 * 所以这里以服务端数为基准，减去本地流逝的时间。设备时钟不可信这件事
 * 在这里不重要：倒计时只是提示，真正的判定在服务端（design.md §7.3）。
 */
export function useCountdown(secondsUntil: number | null, since: number | null): number | null {
  /**
   * 存的是「过去了多少秒」，不是「还剩多少秒」。
   *
   * 差别在渲染是不是纯的：读 `Date.now()` 算剩余秒数会让每次渲染的结果
   * 都不同，React 的规则里这叫渲染期的不纯调用 —— 而且它也确实是错的，
   * 重渲染一次倒计时就会往回跳。存流逝量、在定时器里更新它，
   * 渲染就只剩一次减法。
   */
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (secondsUntil === null || since === null) return
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - since) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [secondsUntil, since])

  if (secondsUntil === null || since === null) return null
  return Math.max(0, secondsUntil - elapsed)
}
