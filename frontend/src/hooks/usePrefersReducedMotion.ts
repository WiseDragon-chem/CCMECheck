import { useEffect, useState } from 'react'

/** 与 global.css 里的写法保持一致 */
const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 用户是否要求减少动态效果。
 *
 * 目前只有赞助商轮播在用：它的自动播放是 JS 定时器，CSS 那套
 * `@media (prefers-reduced-motion)` 管不到它，只能在这里判。
 *
 * 订阅 change 而不是挂载时读一次：系统设置随时能改，改完不重启应用
 * 也该立刻停下来。jsdom 不实现 matchMedia，由 src/test/setup.ts 垫的
 * 那个桩对任何查询都返回 false —— 也就是测试环境默认「允许动效」。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(QUERY)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
