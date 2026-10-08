import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { OVERALL_TRACK_SENTINEL } from '../src/config/constants.js'
import { SERVER_ROOT } from '../src/config/env.js'
import { AppError } from '../src/core/errors.js'
import { toCsv } from '../src/core/text.js'
import { addDays, cstToday, formatCstDateTime } from '../src/core/time.js'
import { dateOnlySchema } from '../src/core/validation.js'
import { configurePragmas, createPrismaClient } from '../src/db/client.js'
import { requireCurrentCampaign } from '../src/modules/campaigns/service.js'
import { OVERALL_LABEL, toScore } from '../src/modules/leaderboards/service.js'
import { buildScoredRows, loadScoringInputs } from '../src/services/scoring.service.js'
import { findLatestSnapshot } from '../src/services/snapshot.service.js'

/**
 * 导出榜单 CSV（活动结束后出最终榜单用）：一次一个榜单，默认总榜，
 * 用 --track 指定某一个赛道。
 *
 *   npm run export:leaderboard                                # 总榜，截止日取最新快照（已冻结的最终榜单优先）
 *   npm run export:leaderboard -- --track=reading             # 只导出「读书」赛道的榜单
 *   npm run export:leaderboard -- --cutoff=2026-10-07         # 指定统计截止日
 *   npm run export:leaderboard -- --out=/tmp/总榜.csv          # 指定输出路径（默认写到 server/ 下）
 *
 * --track 填赛道 slug（reading / vocabulary / fitness），与排行榜接口的 track 参数同义；
 * 省略即总榜。拼错时会把可用 slug 列出来。
 *
 * 与后台导出接口（GET /api/v1/admin/exports/leaderboard.csv）的关系：
 * 统计口径与截止日的回退顺序完全一致，区别只在出口 —— 接口要登录后台账号，
 * 这个脚本直接读库写文件，供本机与服务器上快速导出，
 * 也是后台界面尚未做导出功能时的替代（README「活动结束后」一节）。
 * 后台接口一次导出全部榜单（带「榜单」列），这里一次一个榜单，所以没有那一列。
 *
 * 分值不在这里另算：走 loadScoringInputs + buildScoredRows，与排行榜、快照、后台导出
 * 共用同一个计分引擎。本文件只是榜单的呈现层，改计分规则不需要动它。
 *
 * 表内包含 0 分的参与者（与快照、后台导出口径一致）；姓名用真实姓名，
 * 与后台导出一致，不受活动配置的 nameDisplayMode 影响。
 */

interface ScriptArgs {
  cutoff?: string
  out?: string
  /** 赛道 slug；省略时导出总榜 */
  track?: string
}

const USAGE =
  '用法：npm run export:leaderboard -- [--track=赛道slug] [--cutoff=YYYY-MM-DD] [--out=路径]'

function parseArgs(argv: readonly string[]): ScriptArgs {
  const args: ScriptArgs = {}
  for (const arg of argv) {
    if (arg.startsWith('--cutoff=')) {
      const parsed = dateOnlySchema.safeParse(arg.slice('--cutoff='.length))
      if (!parsed.success) throw new AppError('VALIDATION_FAILED', `--cutoff 需要 YYYY-MM-DD：${arg}`)
      args.cutoff = parsed.data
      continue
    }
    if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length)
      continue
    }
    if (arg.startsWith('--track=')) {
      const track = arg.slice('--track='.length).trim()
      if (!track) throw new AppError('VALIDATION_FAILED', `--track 需要赛道 slug：${arg}\n${USAGE}`)
      args.track = track
      continue
    }
    throw new AppError('VALIDATION_FAILED', `未知参数：${arg}\n${USAGE}`)
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const prisma = createPrismaClient()
  try {
    await configurePragmas(prisma)

    const campaign = await requireCurrentCampaign(prisma)

    // --track 的语义与排行榜接口一致（leaderboards/service.ts 的 resolveTrack）：
    // 填赛道 slug，省略或填总榜哨兵即总榜。这里不直接复用那个函数，
    // 是为了顺手拿到全部赛道 —— 拼错 slug 时能把可选项列出来。
    const campaignTracks = await prisma.campaignTrack.findMany({
      where: { campaignId: campaign.id },
      include: { track: { select: { slug: true, name: true } } },
      orderBy: { track: { sortOrder: 'asc' } },
    })
    const trackRef = args.track === OVERALL_TRACK_SENTINEL ? undefined : args.track
    const chosen = trackRef
      ? campaignTracks.find((item) => item.track.slug === trackRef)
      : undefined
    if (trackRef && !chosen) {
      const slugs = campaignTracks.map((item) => item.track.slug).join('、')
      throw new AppError(
        'VALIDATION_FAILED',
        `未知赛道：${trackRef}${slugs ? `（可用：${slugs}）` : ''}`,
      )
    }
    const boardSlug = chosen?.track.slug ?? OVERALL_TRACK_SENTINEL
    const boardName = chosen?.track.name ?? OVERALL_LABEL

    // 截止日的回退顺序与后台导出接口一致：已冻结的最终榜单 > 最新可用快照 > 昨天
    const frozen = await prisma.leaderboardSnapshot.findFirst({
      where: { campaignId: campaign.id, isFinal: true },
      orderBy: { cutoffDate: 'desc' },
      select: { cutoffDate: true },
    })
    const latest = frozen ?? (await findLatestSnapshot(campaign.id, prisma))
    const cutoffDate = args.cutoff ?? latest?.cutoffDate ?? addDays(cstToday(), -1)

    if (cutoffDate < campaign.startDate) {
      throw new AppError(
        'VALIDATION_FAILED',
        `统计截止日 ${cutoffDate} 早于活动开始日 ${campaign.startDate}`,
      )
    }

    const inputs = await loadScoringInputs(campaign.id, cutoffDate, prisma)
    // 只留所选榜单的行；buildScoredRows 的每个榜单段本身已按名次排好，filter 不会打乱顺序
    const scoredRows = buildScoredRows(inputs).filter((row) => row.trackSlug === boardSlug)

    if (
      chosen &&
      inputs.configs.some((config) => config.slug === boardSlug && !config.enabled)
    ) {
      console.warn(`⚠ 赛道「${boardName}」已停用，榜单里不会有任何行`)
    }

    const participants = await prisma.campaignParticipant.findMany({
      where: { campaignId: campaign.id },
      include: { user: { select: { studentId: true, name: true } } },
    })
    const participantById = new Map(participants.map((item) => [item.id, item]))

    // 列与后台导出的排行榜 CSV 保持一致，只少一列「榜单」—— 本文件一次只有一个榜单
    const headers = ['名次', '学号', '姓名', '班级', '积分', '积分(毫点)', '有效天数', '达到积分时间(北京时间)']
    const csvRows = scoredRows.map((row) => {
      const participant = participantById.get(row.participantId)
      return [
        row.rank,
        participant?.user.studentId ?? '',
        participant?.user.name ?? '',
        participant?.className ?? '',
        toScore(row.score),
        row.score,
        row.validDays,
        row.reachedAt ? formatCstDateTime(row.reachedAt) : '',
      ]
    })

    const defaultOut = path.join(SERVER_ROOT, `leaderboard-${campaign.name}-${boardName}-${cutoffDate}.csv`)
    const outPath = path.resolve(args.out ?? defaultOut)
    writeFileSync(outPath, toCsv(headers, csvRows))

    const basis = args.cutoff
      ? '由 --cutoff 指定'
      : frozen
        ? '已冻结的最终榜单'
        : latest
          ? '最新可用快照'
          : '无快照，按「昨天」口径'
    console.log(`✔ 已导出：${outPath}`)
    console.log(`  活动：${campaign.name}`)
    console.log(`  榜单：${boardName}`)
    console.log(`  统计截止：${cutoffDate}（${basis}）`)
    console.log(`  行数：${csvRows.length}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
