import { stopChildren } from './global-setup.js'

/**
 * 关掉 globalSetup 起的那两个进程。
 *
 * globalSetup 与 globalTeardown 在同一个进程里执行，所以直接共享模块级的
 * 子进程列表即可 —— 这也是没有用 Playwright 的 webServer 配置的原因之一，
 * 它把进程生命周期藏了起来，出问题时不好排查。
 */
export default function globalTeardown(): void {
  stopChildren()
}
