import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { queryClient } from './api/queryClient'
import { router } from './routes/router'
import { themeConfig } from './styles/antd-theme'
import { useAuthStore } from './stores/auth.store'
import './styles/global.css'

// 不配这两处，日期选择器与分页会冒出英文
dayjs.locale('zh-cn')

/**
 * 启动门。
 *
 * 先用 HttpOnly Cookie 里的刷新令牌换访问令牌（见 tokenStore 的说明），
 * 落定之前不渲染路由 —— 否则已登录用户在刷新页面时会先看到登录页，
 * 再被弹回主页，闪一下很难看。
 */
void useAuthStore.getState().bootstrap()

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      {/* AntdApp 提供 message/modal/notification 的上下文，让它们能吃到主题与语言 */}
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
