import { beforeEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '../../src/db/client.js'
import { toScore } from '../../src/modules/leaderboards/service.js'
import { computeParticipantScore } from '../../src/services/scoring.service.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createEntry, createParticipant, createUser, TEST_PASSWORD } from '../helpers/factory.js'
import { cst } from '../helpers/time.js'

/**
 * design.md §16.16 CSV 导出的人数、记录数和积分与数据库统计一致
 *
 * 断言的关键在「小分值可手算」：把各赛道 dailyPoints 显式配成 1000/2000/500，
 * 于是每条通过记录的得分是可以逐行核对的整数，而不是「跟另一个接口比一比」。
 * 排行榜部分则直接调用计分引擎算期望值 —— §16.16 要求的正是导出不得另写一套算法。
 */

/**
 * 极简 RFC 4180 解析。
 * src/core/text.ts 的 csvCell 会给含逗号/引号/换行的字段加引号，
 * 因此不能用 split('\r\n') + split(',') 这种朴素写法。
 */
function parseCsv(text: string): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!

    if (inQuotes) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // \r\n 的两个字符只当作一个换行处理
    } else if (char === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

describe('§16.16 CSV 导出与数据库统计一致', () => {
  const db = getPrismaClient()

  const ADMIN_STUDENT_ID = 'admin1'
  const DATES = ['2026-10-01', '2026-10-02', '2026-10-03']
  const SLUGS = ['reading', 'vocabulary', 'fitness'] as const
  /** 毫点：1000 = 1 分 */
  const DAILY_POINTS: Record<string, number> = { reading: 1000, vocabulary: 2000, fitness: 500 }
  /** 三种状态轮流出现，保证三种分支都有数据 */
  const STATUS_CYCLE = ['approved', 'pending', 'rejected'] as const

  const CHECKIN_HEADERS = [
    '学号',
    '姓名',
    '班级',
    '赛道',
    '活动日',
    '状态',
    '版本号',
    '提交时间(北京时间)',
    '审核时间(北京时间)',
    '证明材料张数',
    '备注',
    '驳回原因',
    '计分(毫点)',
    '是否管理员补录',
  ]
  const CHECKIN_COL = {
    studentId: 0,
    className: 2,
    track: 3,
    activityDate: 4,
    status: 5,
    reviewedAt: 8,
    note: 10,
    rejectionReason: 11,
    points: 12,
    isManual: 13,
  } as const

  const LEADERBOARD_HEADERS = ['榜单', '名次', '学号', '姓名', '班级', '积分', '积分(毫点)', '有效天数', '达到积分时间(北京时间)']
  const LEADERBOARD_COL = { board: 0, rank: 1, studentId: 2, score: 5, scoreMilli: 6, validDays: 7 } as const

  let campaignId: string
  let adminUserId: string
  let adminToken: string
  let trackIdBySlug: Record<string, string>
  let nameBySlug: Record<string, string>
  let dailyPointsByName: Record<string, number>
  let roster: Array<{ participantId: string; studentId: string }>

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      // 显式写死各赛道分值，期望积分才能手算
      trackConfig: {
        reading: { dailyPoints: DAILY_POINTS.reading! },
        vocabulary: { dailyPoints: DAILY_POINTS.vocabulary! },
        fitness: { dailyPoints: DAILY_POINTS.fitness! },
      },
    })
    campaignId = campaign.id
    trackIdBySlug = Object.fromEntries(tracks.map((track) => [track.slug, track.id]))
    nameBySlug = Object.fromEntries(tracks.map((track) => [track.slug, track.name]))
    dailyPointsByName = Object.fromEntries(tracks.map((track) => [track.name, DAILY_POINTS[track.slug]!]))

    const admin = await createUser({ studentId: ADMIN_STUDENT_ID, name: '超级管理员', role: 'super_admin' })
    adminUserId = admin.id
    adminToken = (await login(ADMIN_STUDENT_ID, TEST_PASSWORD)).accessToken

    roster = []
    for (const [pIndex, studentId] of ['2026001', '2026002', '2026003'].entries()) {
      const user = await createUser({ studentId, name: `参赛者${pIndex + 1}` })
      const participant = await createParticipant({ campaignId, userId: user.id, className: '化学院一班' })
      roster.push({ participantId: participant.id, studentId })

      for (const [dIndex, activityDate] of DATES.entries()) {
        for (const [tIndex, slug] of SLUGS.entries()) {
          const target = STATUS_CYCLE[(pIndex + dIndex + tIndex) % STATUS_CYCLE.length]!

          // 备注里刻意带上逗号与引号，用来验证 csvCell 的引号转义真的能被解析回来
          const note = slug === 'reading' && dIndex === 0 ? '读书 30 页, 已"完成"' : `${slug} ${activityDate} 打卡`

          const { entry } = await createEntry({
            campaignId,
            participantId: participant.id,
            trackId: trackIdBySlug[slug]!,
            activityDate,
            note,
          })

          if (target === 'approved') {
            // §9.3：「达到积分时间」由 reviewed_at 决定，因此审核通过必须显式写入该时间。
            // 每条记录的审核时间各不相同，reachedAt 才有确定的先后顺序。
            await db.checkinEntry.update({
              where: { id: entry.id },
              data: {
                status: 'approved',
                reviewedAt: new Date(cst(activityDate, '20:00:00').getTime() + (pIndex * 3 + tIndex) * 60_000),
                reviewedBy: adminUserId,
              },
            })
          } else if (target === 'rejected') {
            await db.checkinEntry.update({
              where: { id: entry.id },
              data: {
                status: 'rejected',
                // 驳回同样是一次审核动作，必须带审核时间：
                // 线上由 reviews 服务的 reject 写入，这里直接改库要自行补齐，
                // 否则导出里会出现「已驳回但没有审核时间」的假象
                reviewedAt: new Date(cst(activityDate, '20:00:00').getTime() + (pIndex * 3 + tIndex) * 60_000),
                reviewedBy: adminUserId,
                rejectionCode: 'screenshot_date_mismatch',
                rejectionReason: '截图日期不符合',
              },
            })
          }
        }
      }
    }
  })

  /** 与导出服务共用同一份赛道配置，避免测试里手抄一遍分值 */
  async function loadConfigs() {
    const campaignTracks = await db.campaignTrack.findMany({
      where: { campaignId },
      include: { track: { select: { slug: true } } },
    })
    return campaignTracks.map((item) => ({
      trackId: item.trackId,
      slug: item.track.slug,
      dailyPoints: item.dailyPoints,
      dailyCap: item.dailyCap,
      campaignCap: item.campaignCap,
      overallWeight: item.overallWeight,
      enabled: item.enabled,
    }))
  }

  /** 直接用计分引擎算出期望积分（§16.16：导出不得有自己的一套公式） */
  async function scoreOf(participantId: string, configs: Awaited<ReturnType<typeof loadConfigs>>) {
    const approved = await db.checkinEntry.findMany({
      where: { participantId, status: 'approved' },
      select: { activityDate: true, reviewedAt: true, track: { select: { slug: true } } },
    })

    return computeParticipantScore({
      participantId,
      configs,
      input: {
        participantId,
        entries: approved.map((entry) => ({
          trackSlug: entry.track.slug,
          activityDate: entry.activityDate,
          reviewedAt: entry.reviewedAt,
        })),
        adjustments: [],
      },
    })
  }

  it('打卡明细导出的记录数、表头与逐行计分与数据库一致', async () => {
    const response = await authed(adminToken).get('/api/v1/admin/exports/checkins.csv')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    // 带 UTF-8 BOM，否则 Windows 版 Excel 打开中文列名会乱码
    expect(response.text.startsWith('﻿')).toBe(true)

    const rows = parseCsv(response.text)
    expect(rows[0]).toEqual(CHECKIN_HEADERS)

    const dataRows = rows.slice(1)
    expect(dataRows).toHaveLength(await db.checkinEntry.count())
    expect(dataRows).toHaveLength(3 * DATES.length * SLUGS.length)

    // 人数一致：导出里出现的学号集合就是名单本身
    const exportedStudentIds = [...new Set(dataRows.map((row) => row[CHECKIN_COL.studentId]))].sort()
    expect(exportedStudentIds).toEqual(roster.map((item) => item.studentId).sort())

    for (const row of dataRows) {
      const status = row[CHECKIN_COL.status]!
      const trackName = row[CHECKIN_COL.track]!
      const expected = status === 'approved' ? dailyPointsByName[trackName] : 0

      expect(expected, `导出出现未知赛道 ${trackName}`).toBeDefined()
      expect(
        Number(row[CHECKIN_COL.points]),
        `${row[CHECKIN_COL.studentId]} ${row[CHECKIN_COL.activityDate]} ${trackName} ${status}`,
      ).toBe(expected)

      // 审核时间只有通过/驳回的记录才有，且必须与状态一致
      expect(row[CHECKIN_COL.reviewedAt] === '').toBe(status === 'pending')
      // 驳回原因只出现在驳回记录上，参赛者据此知道为什么被打回（§16.6）
      expect(row[CHECKIN_COL.rejectionReason] !== '').toBe(status === 'rejected')
      expect(row[CHECKIN_COL.isManual]).toBe('否')
    }

    // 带逗号与引号的备注必须原样还原，没有被字段分隔符切碎
    const quoted = dataRows.find((row) => row[CHECKIN_COL.note] === '读书 30 页, 已"完成"')
    expect(quoted, '带引号的备注没有被正确解析').toBeDefined()
  })

  it('打卡明细导出的筛选条件同样只计通过审核的记录', async () => {
    const approvedTotal = await db.checkinEntry.count({ where: { status: 'approved' } })
    const response = await authed(adminToken).get('/api/v1/admin/exports/checkins.csv?status=approved')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const rows = parseCsv(response.text).slice(1)

    // 记录数按筛选条件收敛，且每条都是满分（未通过的记录一律不导出）
    expect(rows).toHaveLength(approvedTotal)
    expect(rows.every((row) => row[CHECKIN_COL.status] === 'approved')).toBe(true)
    expect(rows.every((row) => Number(row[CHECKIN_COL.points]) > 0)).toBe(true)
  })

  it('排行榜导出的每人积分等于计分引擎的结果', async () => {
    const response = await authed(adminToken).get('/api/v1/admin/exports/leaderboard.csv?cutoff_date=2026-10-07')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.text.startsWith('﻿')).toBe(true)

    const rows = parseCsv(response.text)
    expect(rows[0]).toEqual(LEADERBOARD_HEADERS)

    const dataRows = rows.slice(1)
    // 人数一致：每位参赛者在每个赛道榜与总榜各出现一次
    expect(dataRows).toHaveLength(roster.length * (SLUGS.length + 1))

    const configs = await loadConfigs()

    for (const item of roster) {
      const scored = await scoreOf(item.participantId, configs)
      const own = dataRows.filter((row) => row[LEADERBOARD_COL.studentId] === item.studentId)
      expect(own, item.studentId).toHaveLength(SLUGS.length + 1)

      const overall = own.find((row) => row[LEADERBOARD_COL.board] === '总榜')
      expect(overall, `${item.studentId} 缺少总榜行`).toBeDefined()
      // 核心断言：导出的总榜积分必须等于计分引擎的结果，导出不能另写一套算法
      expect(Number(overall![LEADERBOARD_COL.scoreMilli]), item.studentId).toBe(scored.totalScore)
      expect(Number(overall![LEADERBOARD_COL.score])).toBe(toScore(scored.totalScore))
      expect(Number(overall![LEADERBOARD_COL.validDays])).toBe(scored.totalValidDays)

      for (const slug of SLUGS) {
        const trackRow = own.find((row) => row[LEADERBOARD_COL.board] === nameBySlug[slug])
        expect(trackRow, `${item.studentId} 缺少 ${slug} 榜行`).toBeDefined()
        expect(Number(trackRow![LEADERBOARD_COL.scoreMilli]), `${item.studentId} ${slug}`).toBe(
          scored.tracks.get(slug)!.score,
        )
        expect(Number(trackRow![LEADERBOARD_COL.validDays])).toBe(scored.tracks.get(slug)!.validDays)
      }
    }

    // 排名与积分同向：第一名的积分不低于任何其他人
    const overallRows = dataRows.filter((row) => row[LEADERBOARD_COL.board] === '总榜')
    const byScore = [...overallRows].sort(
      (a, b) => Number(b[LEADERBOARD_COL.scoreMilli]) - Number(a[LEADERBOARD_COL.scoreMilli]),
    )
    expect(Number(byScore[0]![LEADERBOARD_COL.rank])).toBe(1)
  })

  it('名册导出的行数与参赛人数一致', async () => {
    const response = await authed(adminToken).get('/api/v1/admin/exports/participants.csv')

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.text.startsWith('﻿')).toBe(true)

    const rows = parseCsv(response.text)
    expect(rows[0]).toEqual(['学号', '姓名', '班级', '报名状态', '账号状态', '手机尾号', '备注', '加入时间(北京时间)'])
    expect(rows.slice(1)).toHaveLength(await db.campaignParticipant.count({ where: { campaignId } }))
    expect(rows.slice(1).map((row) => row[0]).sort()).toEqual(roster.map((item) => item.studentId).sort())
  })

  it('导出需要超管或被授予 exports.run 的账号', async () => {
    const participant = await createUser({ studentId: '2026009', name: '路人' })
    const session = await login('2026009', TEST_PASSWORD)
    void participant

    const response = await authed(session.accessToken).get('/api/v1/admin/exports/checkins.csv')
    expect(response.status, JSON.stringify(response.body)).toBe(403)
    expect(response.body.code).toBe('ROLE_REQUIRED')
  })
})
