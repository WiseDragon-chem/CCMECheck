import { QueryClient } from '@tanstack/react-query'

/**
 * 全局 QueryClient。
 *
 * 默认值的取舍：
 *
 * - `staleTime: 30s` —— 今日卡片这类数据变化不频繁但对时效敏感，
 *   30 秒内切页面不重复请求，超过则重新取。
 *
 * - `retry: 1`（查询）—— 网络抖动重试一次是有价值的；再多只会让
 *   已经明确失败的页面多转几秒。
 *
 * - `retry: 0`（写操作）—— 写操作**绝不静默重放**。打卡提交有幂等键兜底，
 *   但其它写操作重放可能产生意料之外的副作用。
 *
 * - `refetchOnWindowFocus: true` —— 参赛者常从微信切回来，
 *   回到前台时刷新一次让卡片状态与现实一致。
 *   管理端的审核详情页会单独关掉它（见后续阶段）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
