import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * 每个用例后卸载已渲染的组件。
 *
 * Testing Library 的自动清理只在 globals 打开时才会自行注册，
 * 而本项目关掉了 globals（显式 import 更利于静态分析）——
 * 少了这一步，上一个用例的 DOM 会残留到下一个，
 * 表现为「找不到元素」或「找到多个元素」这类误导性失败。
 */
afterEach(() => {
  cleanup()
})

/**
 * Vitest 全局准备。
 *
 * jsdom 没有实现几个 antd 依赖的浏览器 API，缺失时组件会直接抛错，
 * 而且报错信息（matchMedia is not a function）与真实原因相去甚远。
 * 这里补齐最小可用实现。
 */

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver
}

if (!window.scrollTo) {
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo
}
