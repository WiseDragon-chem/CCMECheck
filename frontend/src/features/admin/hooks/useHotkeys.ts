import { useEffect, useRef } from 'react'

/**
 * 审核页的键盘操作（design.md §8.2）。
 *
 * 这一屏的全部价值就在键盘流上，所以「什么时候**不该**响应」比
 * 「什么时候响应」更要紧 —— 每一条守卫都对应一次真实的数据事故。
 */

export interface HotkeyBinding {
  /** 单个字符，大小写不敏感 */
  key: string
  handler: () => void
  /**
   * 是否允许在输入框里触发。
   * 默认不允许 —— 否则在驳回原因里打一个字就会审掉一条记录。
   * `Esc` 是唯一该开这个口子的键。
   */
  allowInInput?: boolean
}

export interface KeyEventLike {
  key: string
  isComposing?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * 该不该处理这次按键。
 *
 * 抽成纯函数是为了能单独测 —— 三条守卫都有明确的失败模式，
 * 而它们在真实浏览器里很难稳定复现（尤其是输入法那条）。
 */
export function shouldHandleKey(event: KeyEventLike, target: unknown, allowInInput = false): boolean {
  // 组合键留给浏览器与系统，不抢
  if (event.ctrlKey || event.metaKey || event.altKey) return false

  /**
   * 中文输入法。
   *
   * 这是这一屏最可能出的生产事故：审核员开着输入法在驳回原因里打字，
   * 而 a / r / j / k 正是拼音里的常见字母 —— 每敲一个 a 就通过一条记录，
   * 且界面上不会有任何提示。
   *
   * 输入法组合期间的 keydown 带 isComposing，部分浏览器还给出 keyCode 229，
   * 两者都要认。
   */
  if (event.isComposing) return false

  const element = target as { tagName?: string; isContentEditable?: boolean } | null
  const tagName = element?.tagName?.toUpperCase()

  const isEditable =
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element?.isContentEditable === true

  if (isEditable && !allowInInput) return false

  return true
}

export interface UseHotkeysOptions {
  /**
   * 全局开关。预览打开、弹窗打开时必须关掉 ——
   * 否则审阅过程中按 A 会误通过记录。
   */
  enabled?: boolean
}

export function useHotkeys(bindings: readonly HotkeyBinding[], options: UseHotkeysOptions = {}): void {
  const enabled = options.enabled ?? true

  // 把最新的绑定放进 ref：调用方通常传内联数组，
  // 直接进依赖数组会让监听器每渲染一次就重绑一次
  const bindingsRef = useRef(bindings)

  // 赋值放在 effect 里而不是渲染期：渲染期写 ref 在并发渲染下会被丢弃或重复，
  // 而 effect 一定在浏览器处理下一个按键之前跑完，所以拿到的仍是最新的那一份
  useEffect(() => {
    bindingsRef.current = bindings
  })

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      for (const binding of bindingsRef.current) {
        if (binding.key.toLowerCase() !== key) continue
        if (!shouldHandleKey(event, event.target, binding.allowInInput)) continue

        // 命中就阻止默认行为：方向键不该同时滚动页面，
        // 否则 J/K 切换记录时整页会跟着抖
        event.preventDefault()
        binding.handler()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
