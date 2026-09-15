import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // SQLite 只允许单写入者，测试库在文件之间共享，因此串行执行。
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
})
