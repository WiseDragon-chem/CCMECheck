import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 端到端测试的环境准备。
 *
 * **完全独立于开发环境**：自己的数据库文件、自己的后端端口、自己的前端端口。
 * 后端的 README 已经警告过「两个 vitest 不能并行」，因为测试库会被互相清表；
 * 端到端测试更严重 —— 它会把开发库里手测用的数据一起搅乱。
 *
 * 顺序：建库 → 迁移 → 起后端 → 起前端 → 播种 → 交给测试。
 * 播种必须等服务真的起来，所以没有用 Playwright 的 webServer 配置 ——
 * 那东西和 globalSetup 的先后顺序在不同版本间变过，这里显式控制更稳妥。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.resolve(HERE, '..')
const SERVER_ROOT = path.resolve(FRONTEND_ROOT, '..', 'server')

export const E2E_DB_FILE = path.join(SERVER_ROOT, 'prisma', 'e2e.db')
export const E2E_API_PORT = 3100
export const E2E_WEB_PORT = 5174
export const E2E_BASE_URL = `http://localhost:${E2E_WEB_PORT}`
export const E2E_API_BASE = `http://localhost:${E2E_API_PORT}/api/v1`

/** 播种出来的账号，供用例直接使用 */
export const E2E_PARTICIPANT = { studentId: '2026001', password: 'DevPassw0rd!' }

const children: ChildProcess[] = []

export default async function globalSetup(): Promise<void> {
  resetDatabase()
  startBackend()
  startFrontend()
  await Promise.all([waitForBackend(), waitForFrontend()])
  await seed()
}

const E2E_DATABASE_URL = 'file:./prisma/e2e.db'

/** 直接用 node 执行目标脚本，绕开 npx 与 shell 的引号问题 */
function runNode(entry: string, args: string[], cwd: string): void {
  execFileSync(process.execPath, [entry, ...args], {
    cwd,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'inherit',
  })
}

function resetDatabase(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${E2E_DB_FILE}${suffix}`
    if (fs.existsSync(file)) fs.rmSync(file)
  }

  const prismaCli = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js')
  const tsxCli = path.join(SERVER_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

  // 直接调入口脚本而不是 npx —— Windows 上 shell:true 会把参数交给 cmd.exe
  // 拼接并破坏它，shell:false 又找不到 npx（只有 npx.cmd）
  runNode(prismaCli, ['migrate', 'deploy'], SERVER_ROOT)

  // 迁移只建表。管理员与三个赛道由后端自己的种子脚本创建 ——
  // 少了这一步，接下来的播种会以「管理员登录 401」告终，
  // 而那个报错完全看不出真正的原因
  runNode(tsxCli, ['prisma/seed.ts'], SERVER_ROOT)
}

function startBackend(): void {
  const child = spawn(
    process.execPath,
    [path.join(SERVER_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'file:./prisma/e2e.db',
        PORT: String(E2E_API_PORT),
        // 定时任务会和测试抢写锁，且测试不依赖它
        SCHEDULER_ENABLED: 'false',
        LOG_LEVEL: 'warn',
        /**
         * 必须把 e2e 前端的地址加进白名单。
         *
         * 虽然前端是通过 Vite 代理访问 /api 的，但代理会把浏览器的 Origin 头
         * 原样转发给后端 —— 所以后端的 CORS 校验照样会跑，
         * 少了这一项每个请求都会以「来源不在 CORS 白名单中」500 告终，
         * 而浏览器上看到的只是「服务器出错了」。
         */
        CORS_ORIGINS: `http://localhost:${E2E_WEB_PORT}`,
        /**
         * 签名图片地址是绝对的，host 取自这个配置。
         *
         * 不跟着端口改的话，签名地址会指向 .env 里的 3000 端口 ——
         * 那里没有服务在听，图片就**静默**加载失败：
         * 没有报错、没有提示，只是详情页上留一个灰框。
         */
        PUBLIC_BASE_URL: `http://localhost:${E2E_API_PORT}`,
      },
      stdio: 'inherit',
    },
  )
  children.push(child)
}

function startFrontend(): void {
  const child = spawn(
    process.execPath,
    [path.join(FRONTEND_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(E2E_WEB_PORT), '--strictPort'],
    {
      cwd: FRONTEND_ROOT,
      env: { ...process.env, VITE_PROXY_TARGET: `http://localhost:${E2E_API_PORT}` },
      stdio: 'inherit',
    },
  )
  children.push(child)
}

async function waitFor(url: string, label: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内没有就绪：${url}`)
}

const waitForBackend = () => waitFor(`http://localhost:${E2E_API_PORT}/healthz`, '后端')
const waitForFrontend = () => waitFor(E2E_BASE_URL, '前端')

async function seed(): Promise<void> {
  execFileSync(
    process.execPath,
    [path.join(FRONTEND_ROOT, 'tools', 'seed-dev.mjs')],
    {
      cwd: FRONTEND_ROOT,
      env: { ...process.env, SEED_API_BASE: E2E_API_BASE },
      stdio: 'inherit',
    },
  )
}

/** 由 globalTeardown 调用 */
export function stopChildren(): void {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
}
