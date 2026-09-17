#!/usr/bin/env node
/**
 * 开发数据播种。
 *
 * 后端的 `npm run seed` 只建超管与三个赛道，**没有活动** ——
 * 于是 resolveCurrentCampaign 会对所有参赛者接口抛 CAMPAIGN_NOT_ACTIVE，
 * 全新拉下来的项目前端完全不可用。这个脚本补上那一块。
 *
 * 走真实 HTTP 接口而非直接写库，原因有三：
 *   1. 直接写库要自己伪造 version、current_revision_id、review_actions、
 *      快照行，以及最麻烦的 storage/ 里真实的图片字节（objectKey 还必须匹配
 *      ^[a-f0-9]{2}/[a-f0-9]{8,}$）。走 HTTP 则字节、EXIF 剥离、尺寸、
 *      sha256 全部天然正确。
 *   2. 业务不变量（版本号、审计行、快照幂等）自动满足。
 *   3. 这个脚本顺带成了一次端到端冒烟。
 *
 * 用法：
 *   node tools/seed-dev.mjs                # 默认场景
 *   node tools/seed-dev.mjs --scenario closed
 *   node tools/seed-dev.mjs --freeze       # 额外冻结一份榜单
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makePng } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ENV = path.resolve(HERE, '..', '..', 'server', '.env')

const API = process.env.SEED_API_BASE ?? 'http://localhost:3000/api/v1'
const DEV_PASSWORD = process.env.SEED_PARTICIPANT_PASSWORD ?? 'DevPassw0rd!'

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const scenario = readArg('--scenario') ?? 'day'
const shouldFreeze = argv.includes('--freeze')
/**
 * 只切换场景，不重新播种。
 *
 * 卡片状态是由活动窗口决定的，开发时会在几种状态之间反复来回；
 * 每换一次都重播 138 条记录是纯粹的浪费，而且重播本身还会与已有数据打架。
 */
const scenarioOnly = argv.includes('--scenario-only')

function readArg(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

// ---------------------------------------------------------------------------
// 管理员凭据：直接读 server/.env，避免让人在两处维护同一份密码
// ---------------------------------------------------------------------------

function readServerEnv() {
  if (!fs.existsSync(SERVER_ENV)) return {}
  const out = {}
  for (const line of fs.readFileSync(SERVER_ENV, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

const serverEnv = readServerEnv()
const ADMIN_STUDENT_ID = serverEnv.SEED_ADMIN_STUDENT_ID || 'admin'
const ADMIN_PASSWORD = serverEnv.SEED_ADMIN_PASSWORD || 'admin12345'

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

let adminToken = null

async function call(method, endpoint, { token, body, form, raw } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) {
    payload = form // FormData 自己带 Content-Type 边界
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`${API}${endpoint}`, { method, headers, body: payload })
  if (raw) return response

  const text = await response.text()
  const parsed = text ? safeJson(text) : null
  if (!response.ok) {
    const err = new Error(
      `${method} ${endpoint} -> ${response.status} ${parsed?.code ?? ''} ${parsed?.message ?? text.slice(0, 200)}`,
    )
    err.status = response.status
    err.body = parsed
    throw err
  }
  return parsed
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 把 HTTP 日期按北京时间取 YYYY-MM-DD */
function cstDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return shifted.toISOString().slice(0, 10)
}

const TODAY = cstDate(0)

// ---------------------------------------------------------------------------
// 种子内容
// ---------------------------------------------------------------------------

const CLASSES = ['化学 1 班', '化学 2 班', '材料 1 班', '材料 2 班']
const SURNAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙']
const GIVEN = ['文博', '思远', '雨欣', '子涵', '佳怡', '宇轩', '梓萱', '浩然', '欣怡', '俊杰', '诗涵', '泽宇']
const TRACKS = ['reading', 'vocabulary', 'fitness']

const PARTICIPANT_COUNT = 24
const IMAGE_SIZES = [
  [320, 240],
  [480, 640], // 竖图，验证前端的等比展示
  [640, 360],
]

function participantRows() {
  const rows = []
  for (let i = 0; i < PARTICIPANT_COUNT; i++) {
    const name = `${SURNAMES[i % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`
    rows.push({
      studentId: `2026${String(i + 1).padStart(3, '0')}`,
      name,
      className: CLASSES[i % CLASSES.length],
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const log = (...args) => console.log(...args)
const step = (n, text) => log(`\n\x1b[36m[${n}]\x1b[0m ${text}`)

async function main() {
  log('CCME 打卡平台 — 开发数据播种')
  log(`接口：${API}    场景：${scenario}${shouldFreeze ? '    冻结榜单：是' : ''}`)

  step(1, '管理员登录')
  const admin = await call('POST', '/auth/login', {
    body: { student_id: ADMIN_STUDENT_ID, password: ADMIN_PASSWORD },
  })
  adminToken = admin.access_token
  log(`    ✓ ${admin.user.name}（${admin.user.role}）`)

  if (scenarioOnly) {
    step(2, `只切换场景：${scenario}`)
    await applyScenario(scenario)
    log('    ✓ 已应用（未改动任何记录）')
    log('\n刷新前端页面即可看到卡片状态变化。\n')
    return
  }

  step(2, '创建活动（日期相对今天）')
  const campaign = await createCampaign()
  log(`    ✓ ${campaign.name}  ${campaign.start_date} ~ ${campaign.end_date}`)

  step(3, `导入 ${PARTICIPANT_COUNT} 名参赛者`)
  const participants = await importParticipants()
  log(`    ✓ 激活码已发放（明文只在导入响应里出现一次）`)

  step(4, '激活全部账号')
  const tokens = await activateAll(participants)
  log(`    ✓ ${tokens.size} 个账号已激活并登录`)

  step(5, '补齐过去几天的记录（走补录接口）')
  const pastEntries = await backfillPastDays(participants)
  log(`    ✓ 补录 ${pastEntries.length} 条（历史日期已过每日截止，正常接口本就该拒绝，§16.5）`)

  step(6, '今日真实打卡（走 upload 流水线）')
  const submissions = await submitToday(tokens)
  log(`    ✓ ${submissions.length} 条今日记录已提交`)

  step(7, '审核：通过 / 驳回')
  const reviewed = await reviewToday()
  log(`    ✓ 通过 ${reviewed.approved} 条，驳回 ${reviewed.rejected} 条`)

  step(8, '异常操作演示：重开 / 撤销 / 作废 / 积分调整')
  const ops = await exceptionalOps(pastEntries)
  log(`    ✓ 重开 ${ops.reopened}，撤销 ${ops.revoked}，作废 ${ops.voided}，积分调整 ${ops.adjusted}`)

  step(9, '生成排行榜快照')
  await rebuildLeaderboard(cstDate(0))
  log(`    ✓ 已生成统计至 ${TODAY} 的快照`)
  if (shouldFreeze) {
    await freezeLeaderboard(cstDate(0))
    log('    ✓ 已冻结（注意：冻结后再审核不会改变榜单）')
  }

  step(10, `应用场景：${scenario}`)
  await applyScenario(scenario)
  log(`    ✓ 已应用`)

  printSummary(participants)
}

async function createCampaign() {
  const name = '国庆打卡活动 2026'
  // 已存在同名活动时直接复用，让脚本可重复执行
  const existing = await call('GET', '/admin/campaign', { token: adminToken }).catch(() => null)
  if (existing?.campaign?.name === name) return existing.campaign

  const created = await call('POST', '/admin/campaign', {
    token: adminToken,
    body: {
      name,
      description: '北京大学化学与分子工程学院国庆打卡活动（开发数据）',
      start_date: cstDate(-3),
      end_date: cstDate(4),
      daily_open_time: '00:00',
      daily_deadline: '23:59',
      leaderboard_visible: true,
      leaderboard_time: '06:00',
      name_display_mode: 'real',
      // 三个赛道等权，与 src/config/campaign.ts 里的生产配置一致。
      //
      // 早先这里刻意设成 1000/800/1200「让总榜的加权看得出来」，但代价是
      // 演示数据里到处是 8.2、7.7 这种分数 —— 它其实完全正确（毫点换算的结果），
      // 却看起来像浮点故障，每次都要解释一遍。加权路径本身由
      // tests/unit/scoring.test.ts 覆盖，不必靠演示数据兜着。
      tracks: [
        { track_id: 'reading', daily_points: 1000, overall_weight: 1000 },
        { track_id: 'vocabulary', daily_points: 1000, overall_weight: 1000 },
        { track_id: 'fitness', daily_points: 1000, overall_weight: 1000 },
      ],
    },
  })

  await call('PUT', '/admin/campaign', { token: adminToken, body: { status: 'active' } })
  return created.campaign
}

async function importParticipants() {
  const rows = participantRows()
  const csv = [
    'student_id,name,class_name,phone_suffix,remark',
    ...rows.map((r, i) => `${r.studentId},${r.name},${r.className},${String(1000 + i).slice(-4)},`),
  ].join('\n')

  const form = new FormData()
  form.append('file', new Blob([`﻿${csv}`], { type: 'text/csv' }), 'roster.csv')

  const preview = await call('POST', '/admin/participants/import/preview', {
    token: adminToken,
    form,
  })
  if (preview.summary.invalid > 0) {
    throw new Error(`名单校验未通过：${JSON.stringify(preview.summary)}`)
  }

  const commit = await call('POST', '/admin/participants/import/commit', {
    token: adminToken,
    body: { batch_id: preview.batch_id },
  })

  const byStudentId = new Map()
  for (const item of commit.activation_codes ?? []) {
    byStudentId.set(item.student_id, item.activation_code)
  }

  return rows.map((row) => ({ ...row, activationCode: byStudentId.get(row.studentId) }))
}

async function activateAll(participants) {
  const tokens = new Map()
  for (const p of participants) {
    if (!p.activationCode) {
      // 已激活过（脚本重跑）：直接登录
      try {
        const session = await call('POST', '/auth/login', {
          body: { student_id: p.studentId, password: DEV_PASSWORD },
        })
        tokens.set(p.studentId, session.access_token)
      } catch {
        // 拿不到就算了，后面的步骤会跳过这个用户
      }
      continue
    }
    const session = await call('POST', '/auth/activate', {
      body: { student_id: p.studentId, activation_code: p.activationCode, password: DEV_PASSWORD },
    })
    tokens.set(p.studentId, session.access_token)
  }
  return tokens
}

/**
 * 历史日期已过每日截止，正常接口本就该拒绝（§16.5）——
 * 用补录接口，这正是它存在的理由。
 *
 * 补录响应直接带 entry_id 与 version，记下来供后面的撤销演示使用，
 * 不必再去反查。
 */
async function backfillPastDays(participants) {
  const campaign = await call('GET', '/admin/campaign', { token: adminToken })
  const trackIds = new Map(campaign.tracks.map((t) => [t.slug, t.id]))

  const list = await call('GET', '/admin/participants?page_size=100', { token: adminToken })
  const participantIdByStudentId = new Map(list.items.map((i) => [i.student_id, i.id]))

  const entries = []
  for (const [index, p] of participants.entries()) {
    const participantId = participantIdByStudentId.get(p.studentId)
    if (!participantId) continue

    // 越靠前的参与者打卡天数越多，排行榜才有区分度
    const dayCount = index < 6 ? 3 : index < 14 ? 2 : 1
    for (let d = dayCount; d >= 1; d--) {
      const activityDate = cstDate(-d)
      for (const slug of TRACKS) {
        // 不用每个赛道每天都打，让有效天数有差异
        if ((index + d + TRACKS.indexOf(slug)) % 3 === 0) continue
        try {
          const result = await call('POST', '/admin/checkins/manual', {
            token: adminToken,
            body: {
              participant_id: participantId,
              track_id: trackIds.get(slug),
              activity_date: activityDate,
              reason: '开发数据：活动开始前已线下打卡，管理员补录',
              status: 'approved',
            },
          })
          entries.push({ entryId: result.entry_id, version: result.version, studentId: p.studentId, slug })
        } catch (error) {
          if (error.status !== 409) throw error // 409 = 该槽位已存在，重跑时正常
        }
      }
    }
  }
  return entries
}

async function submitToday(tokens) {
  const entries = []
  const studentIds = [...tokens.keys()]

  for (const [index, studentId] of studentIds.entries()) {
    const token = tokens.get(studentId)
    // 不是所有人都今天打，留出「今日未完成」的卡片状态
    if (index % 7 === 6) continue

    for (const [trackIndex, track] of TRACKS.entries()) {
      if ((index + trackIndex) % 5 === 4) continue // 有人某个赛道今天没打

      const imageCount = (index + trackIndex) % 3 === 0 ? 3 : (index + trackIndex) % 3
      const form = new FormData()
      form.append('track', track)
      form.append('activity_date', TODAY)
      form.append('note', `${track} 今日打卡`)
      form.append('client_token', `seed-${studentId}-${track}-${Date.now()}`)
      for (let i = 0; i < imageCount; i++) {
        const [w, h] = IMAGE_SIZES[i % IMAGE_SIZES.length]
        form.append('images', new Blob([makePng(w, h, [40 + i * 60, 120, 200])], { type: 'image/png' }), `${track}-${i}.png`)
      }

      try {
        const result = await call('POST', '/checkins', { token, form })
        entries.push({ studentId, track, entryId: result.entry_id, version: result.version })
      } catch (error) {
        if (error.status !== 409) throw error
      }
    }
  }

  // 给前几条制造「重新提交后有多版本」的数据，让提交历史不是空的
  for (const entry of entries.slice(0, 4)) {
    const token = tokens.get(entry.studentId)
    if (!token) continue
    const form = new FormData()
    form.append('track', entry.track)
    form.append('activity_date', TODAY)
    form.append('note', `${entry.track} 打卡（补充说明）`)
    form.append('client_token', `seed-resubmit-${entry.entryId}`)
    form.append('images', new Blob([makePng(400, 300, [200, 90, 60])], { type: 'image/png' }), 'again.png')
    try {
      const again = await call('POST', '/checkins', { token, form })
      entry.version = again.version
    } catch {
      // 该槽位已被审核，跳过
    }
  }

  return entries
}

async function reviewToday() {
  const queue = await call('GET', '/admin/reviews/queue?page_size=100', { token: adminToken })
  const pending = queue.entries ?? []

  let approved = 0
  let rejected = 0
  const rejectReasons = ['screenshot_date_mismatch', 'content_unrecognizable', 'insufficient_amount']

  for (const [index, entry] of pending.entries()) {
    // 大约每 5 条驳回 1 条，其余通过；留一小撮不审，让待审核队列非空
    if (index % 6 === 5) continue

    if (index % 5 === 4) {
      await call('POST', `/admin/reviews/${entry.entry_id}/reject`, {
        token: adminToken,
        body: {
          version: entry.version,
          reason_code: rejectReasons[index % rejectReasons.length],
          reason: '开发数据：演示驳回流程',
        },
      })
      rejected++
    } else {
      await call('POST', `/admin/reviews/${entry.entry_id}/approve`, {
        token: adminToken,
        body: { version: entry.version },
      })
      approved++
    }
  }
  return { approved, rejected }
}

async function exceptionalOps(pastEntries) {
  const stats = { reopened: 0, revoked: 0, voided: 0, adjusted: 0 }

  const queue = await call('GET', '/admin/reviews/queue?page_size=100', { token: adminToken })
  const pending = queue.entries ?? []

  // 重开：拿一条待审核的做演示
  const toReopen = pending[0]
  if (toReopen) {
    await call('POST', `/admin/checkins/${toReopen.entry_id}/reopen`, {
      token: adminToken,
      body: {
        version: toReopen.version,
        reason: '开发数据：学生申诉截图有日期，临时重新开放核验',
        reopen_minutes: 120,
      },
    })
    stats.reopened = 1
  }

  // 撤销：直接用补录时记下的 entry_id 与 version，不必反查
  const revokeTarget = pastEntries[pastEntries.length - 1]
  if (revokeTarget) {
    await call('POST', `/admin/checkins/${revokeTarget.entryId}/revoke`, {
      token: adminToken,
      body: { version: revokeTarget.version, reason: '开发数据：复查发现证明材料不实' },
    })
    stats.revoked = 1
  }

  // 作废：待审核里再取一条（重开之后剩下的）
  const toVoid = pending.find((e) => e.entry_id !== toReopen?.entry_id)
  if (toVoid) {
    await call('POST', `/admin/checkins/${toVoid.entry_id}/void`, {
      token: adminToken,
      body: { version: toVoid.version, reason: '开发数据：重复提交，作废该记录' },
    })
    stats.voided = 1
  }

  // 积分调整：正负各一笔，让审计与总分都能看出效果
  const list = await call('GET', '/admin/participants?page_size=100', { token: adminToken })
  const first = list.items[0]
  const second = list.items[1]
  if (first) {
    await call('POST', '/admin/score-adjustments', {
      token: adminToken,
      body: {
        participant_id: first.id,
        track_id: 'reading',
        points_delta: 500,
        reason: '开发数据：读书分享额外奖励 0.5 分',
      },
    })
    stats.adjusted++
  }
  if (second) {
    await call('POST', '/admin/score-adjustments', {
      token: adminToken,
      body: {
        participant_id: second.id,
        track_id: '__overall__',
        points_delta: -300,
        reason: '开发数据：证明材料逾期，总榜扣 0.3 分',
      },
    })
    stats.adjusted++
  }

  return stats
}

async function rebuildLeaderboard(cutoffDate) {
  return call('POST', '/admin/leaderboards/rebuild', {
    token: adminToken,
    body: { cutoff_date: cutoffDate, reason: '开发数据：生成排行榜快照' },
  })
}

async function freezeLeaderboard(cutoffDate) {
  return call('POST', '/admin/leaderboards/freeze', {
    token: adminToken,
    body: { cutoff_date: cutoffDate, reason: '开发数据：冻结最终榜单' },
  })
}

/**
 * 三个赛道凑不齐全部卡片状态，这里通过改写活动窗口逐个复现。
 * 这同时是验证「can_submit 会随活动状态变化」的手段。
 */
async function applyScenario(name) {
  /**
   * 每个场景都完整写出活动窗口，而不是只 patch 差异字段。
   *
   * 它们之间是互斥的「视图」，会来回切换；只改差异字段的话，
   * 上一步遗留的设置会渗进来 —— 实测从 before（开放时间 23:58）
   * 切到 settling 时，卡片会残留「尚未开放」的状态。
   */
  const BASELINE = { daily_open_time: '00:00', daily_deadline: '23:59' }
  const patches = {
    day: { ...BASELINE, status: 'active' },
    before: { ...BASELINE, status: 'active', daily_open_time: '23:58' },
    closed: { ...BASELINE, status: 'active', daily_deadline: '00:01' },
    // 活动停止提交：窗口恢复基线，只把状态改成 settling，
    // 这样看到的差异只来自活动状态本身
    settling: { ...BASELINE, status: 'settling' },
  }
  const patch = patches[name]
  if (!patch) throw new Error(`未知场景：${name}（可选：${Object.keys(patches).join(' / ')}）`)
  await call('PUT', '/admin/campaign', { token: adminToken, body: patch })
}

function printSummary(participants) {
  const line = '─'.repeat(64)
  log(`\n${line}`)
  log('  开发数据就绪')
  log(line)
  log(`  管理员     ${ADMIN_STUDENT_ID} / ${ADMIN_PASSWORD}       （超管）`)
  log(`  参赛者     ${participants[0].studentId} / ${DEV_PASSWORD}`)
  log(`             ${participants[1].studentId} / ${DEV_PASSWORD}   …共 ${participants.length} 人`)
  log('  审核员     随管理后台一并在下一阶段提供（本轮不含后台界面）')
  log('')
  log('  场景切换（只改活动窗口，不重播数据）')
  log('    npm run seed:dev -- --scenario-only --scenario day        今日混合状态')
  log('    npm run seed:dev -- --scenario-only --scenario before     全部「尚未开放」')
  log('    npm run seed:dev -- --scenario-only --scenario closed     全部已截止')
  log('    npm run seed:dev -- --scenario-only --scenario settling   活动停止提交')
  log('')
  log('  重播数据：删掉库重来（脚本不保证对已有数据可重复执行）')
  log('    cd ../server && rm prisma/dev.db* && npm run prisma:migrate && npm run seed && npm run dev')
  log('    然后回到 frontend 执行 npm run seed:dev')
  log('')
  log('  注意：历史日期的记录走的是补录接口 —— 每日截止一旦过去，')
  log('        正常提交接口本就该拒绝（§16.5），这是接口设计的必然结果。')
  log(`${line}\n`)
}

main().catch((error) => {
  console.error('\n\x1b[31m播种失败\x1b[0m')
  console.error(error instanceof Error ? error.message : error)
  if (error?.body) console.error(JSON.stringify(error.body, null, 2))
  process.exitCode = 1
})
