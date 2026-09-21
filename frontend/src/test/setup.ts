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

  /*
    jsdom 的 localStorage 在同一文件的用例之间是**共享**的，不清的话
    上一个用例写下的「操作指导看过了」（src/features/guide）会让下一个
    用例里引导不再出现 —— 表现为「单独跑能过、一起跑就挂」。
    与 client.test.ts 里各自 clear 的做法同源，这里统一做一次。
  */
  window.localStorage.clear()
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

/*
  这里原本想滤掉 jsdom 的 "Not implemented: getComputedStyle() ... with
  pseudo-elements"（antd 的浮层组件每次渲染都会踩到，操作指导的 Tour
  渲染时每次吐两行）。实测**拦不住**：那几行走的不是 console.error，
  改写 console.error 一行都减少不了，所以不留这段看似有用实则空转的代码。

  好在量很小 —— 只有真正把引导渲染出来的用例才会产生，一个用例两行。
  真实浏览器里该调用是正常的，属 jsdom 的能力缺口，不是代码问题。
*/
