import '@testing-library/jest-dom/vitest'

/**
 * Vitest 全局准备。
 *
 * 目前只挂载 jest-dom 的匹配器（toBeInTheDocument 之类）。
 * MSW 的服务端在每个用到它的测试文件里自行起停 ——
 * 全局起一个会让「这个测试到底有没有打网络」变得难以判断。
 */
