import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import { themeConfig } from './styles/antd-theme'
import './styles/global.css'

// 不配这两处，日期选择器与分页会冒出英文
dayjs.locale('zh-cn')

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
