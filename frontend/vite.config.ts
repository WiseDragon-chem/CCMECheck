import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    /**
     * 把 /api 代理到后端。
     *
     * 这不是图方便，而是**鉴权能否工作的前提**：刷新令牌是
     * SameSite=Lax + Path=/api/v1/auth 的 HttpOnly Cookie，跨源
     * （:5173 → :3000）的 XHR 根本带不上它，除非放宽成 SameSite=None; Secure ——
     * 那等于为了开发环境削弱生产的安全设置。
     *
     * 走代理后前后端同源，Cookie 行为与线上一致，CORS 也完全不参与。
     *
     * changeOrigin: false —— 保留 Host: localhost:5173。
     * 刷新令牌是 host-only Cookie（.env 里 COOKIE_DOMAIN 为空），
     * 改写 Host 反而会让浏览器认不出它属于当前站点。
     *
     * 图片不走代理：签名地址是绝对地址且设计上无需认证，<img> 直接引用即可。
     * 千万不要改写它的 host —— 那串签名就是凭证，改了就失效。
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * 用函数形式而不是对象形式。
         *
         * 对象形式会把所列模块的**传递依赖**一并划进同一个 chunk ——
         * 于是 antd（它 import 了 react）把 react-dom 整个吞进自己的 chunk，
         * 单独拆出 react 的意图完全落空。
         *
         * 函数形式按模块路径精确分配，没有传递依赖的副作用。
         * 这对参赛者端不是小事：手机用户不该为了几个卡片组件下载整包。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return 'react'
          if (/[\\/]node_modules[\\/](antd|@ant-design|rc-\w+|@rc-component)[\\/]/.test(id)) return 'antd'
          return undefined
        },
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Playwright 用例不能被 vitest 收集
    exclude: ['node_modules', 'dist', 'e2e'],
  },
})
