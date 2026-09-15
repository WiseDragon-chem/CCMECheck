import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/**
 * 把组件挂到它运行时真正需要的上下文里。
 *
 * 每个用例用全新的 QueryClient —— 共用会让上一个用例的缓存串到下一个，
 * 表现为「单独跑能过、一起跑就挂」。
 */
export interface RenderOptions {
  /** 初始路由，用于需要导航的页面 */
  route?: string
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 测试里不要重试，失败就立刻失败，否则一个错误要等好几秒
        retry: false,
        // 关闭窗口聚焦重取，jsdom 下没有真实焦点事件
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = createTestQueryClient()

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  )

  return { ...render(ui, { wrapper: Wrapper }), queryClient }
}
