import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端测试。
 *
 * 与服务、数据库的启动全部交给 e2e/global-setup.ts —— 见那里的说明：
 * 测试跑在独立的库与端口上，不碰开发环境。
 *
 * 串行执行（workers: 1）：用例共享同一份播种数据，
 * 并行会让「待审核队列里现在有几条」这类断言互相干扰。
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  fullyParallel: false,
  workers: 1,
  // 服务与数据都由 globalSetup 准备，重试不会让状态变干净，只会掩盖问题
  retries: 0,
  forbidOnly: Boolean(process.env.CI),

  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5174',
    // 失败时留下可追溯的证据
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobile-chrome',
      // 参赛者端是手机优先的，端到端也用手机尺寸跑
      use: { ...devices['Pixel 7'] },
    },
  ],
})
