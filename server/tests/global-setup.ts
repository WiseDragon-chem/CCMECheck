import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { SERVER_ROOT, TEST_DB_FILE, TEST_DATABASE_URL, TEST_STORAGE_ROOT } from './test-env.js'

/**
 * 测试库准备：每次完整跑测试前重建一个干净的 SQLite 文件并应用迁移。
 *
 * 直接调用 prisma 的入口脚本而不是 `npx`：
 *   * `shell: true` 在 Windows 上会把参数交给 cmd.exe 拼接，实测既会破坏带引号的参数，
 *     也让传入的 env 表达不出效果（表现为迁移打到了开发库上）；
 *   * `shell: false` 时 Windows 又找不到 `npx` 这个可执行文件（只有 npx.cmd）。
 * 用 process.execPath + 入口脚本可以同时绕开这两个问题。
 */
const PRISMA_CLI = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js')

export default function globalSetup(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${TEST_DB_FILE}${suffix}`
    if (fs.existsSync(file)) fs.rmSync(file)
  }
  fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true })

  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  })
}
