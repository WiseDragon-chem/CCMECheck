import {
  CAMPAIGN_CONFIG,
  applyableFields,
  diffFields,
  validateCampaignConfig,
} from '../src/config/campaign.js'
import { configurePragmas, createPrismaClient } from '../src/db/client.js'
import { recordAudit } from '../src/services/audit.service.js'

/**
 * 把 `src/config/campaign.ts` 里的活动与计分规则写进数据库。
 *
 * 为什么需要这个脚本：规则与日期都在代码里，而系统读的是库。
 * 两者之间需要一个**幂等的**同步动作 —— 它就是部署流程里的那一步。
 *
 *   npm run campaign:init
 *
 * 幂等：库里没有活动就创建，有一个就把它改成与代码一致，并打印出改了哪些字段。
 * 打印是刻意的 —— 「改了什么」正是把规则放进代码要换来的东西。
 *
 * 不做的事：
 *   * 不改 `status`。已经跑起来或已结束的活动不该被一次重新部署改回 published，
 *     状态由状态流转任务与人工操作负责（§14）。
 *   * 不重算排行榜。规则变了之后已发布的快照仍是旧的，需要显式重算
 *     （§9.2：快照是历史，不该被悄悄改写）。
 */

/** 库里那一行，取成与 applyableFields 同构的形状，便于逐字段对照 */
function currentFields(campaign: {
  name: string
  description: string | null
  timezone: string
  startDate: string
  endDate: string
  dailyOpenTime: string
  dailyDeadline: string
  leaderboardVisible: boolean
  leaderboardTime: string
  nameDisplayMode: string
  tieBreakRule: string
  minImages: number
  maxImages: number
  maxImageBytes: number
  allowedMimeTypes: string
}): Record<string, unknown> {
  return {
    name: campaign.name,
    description: campaign.description,
    timezone: campaign.timezone,
    start_date: campaign.startDate,
    end_date: campaign.endDate,
    daily_open_time: campaign.dailyOpenTime,
    daily_deadline: campaign.dailyDeadline,
    leaderboard_visible: campaign.leaderboardVisible,
    leaderboard_time: campaign.leaderboardTime,
    name_display_mode: campaign.nameDisplayMode,
    tie_break_rule: campaign.tieBreakRule,
    min_images: campaign.minImages,
    max_images: campaign.maxImages,
    max_image_bytes: campaign.maxImageBytes,
    // 库里存的是 JSON 字符串，配置里是数组
    allowed_mime_types: JSON.parse(campaign.allowedMimeTypes) as string[],
  }
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return '（空）'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

async function main(): Promise<void> {
  validateCampaignConfig()

  const prisma = createPrismaClient()
  try {
    await configurePragmas(prisma)

    const tracks = await prisma.track.findMany({ orderBy: { sortOrder: 'asc' } })
    if (tracks.length === 0) {
      throw new Error('尚未初始化赛道，请先运行 npm run seed —— 活动必须挂在赛道上')
    }

    // 两个方向都要对上：库里有赛道却没有规则，说明配置漏了一个赛道；
    // 配置里有规则却查不到赛道，多半是 slug 写错了。两种都静默地不对，所以都要拦
    const missingRules = tracks.filter((track) => !CAMPAIGN_CONFIG.tracks[track.slug])
    if (missingRules.length > 0) {
      throw new Error(
        `这些赛道在配置里没有计分规则：${missingRules.map((t) => t.slug).join('、')}`,
      )
    }
    const unknownSlugs = Object.keys(CAMPAIGN_CONFIG.tracks).filter(
      (slug) => !tracks.some((track) => track.slug === slug),
    )
    if (unknownSlugs.length > 0) {
      throw new Error(`配置里的赛道在库里不存在：${unknownSlugs.join('、')}`)
    }

    const existing = await prisma.campaign.findMany({
      where: { status: { notIn: ['archived'] } },
      orderBy: { startDate: 'desc' },
    })

    if (existing.length > 1) {
      // 不替管理员猜该改哪一个。多活动并存时先人工整理
      throw new Error(
        `库里有 ${existing.length} 个未归档的活动，无法判断该更新哪一个。` +
          '请先归档多余的活动。',
      )
    }

    const config = applyableFields(CAMPAIGN_CONFIG)

    /** 本次要同步的那个活动。创建与更新两条路都会赋值 */
    let campaignId: string

    if (existing.length === 0) {
      const created = await prisma.campaign.create({
        data: {
          name: CAMPAIGN_CONFIG.name,
          description: CAMPAIGN_CONFIG.description,
          timezone: CAMPAIGN_CONFIG.timezone,
          startDate: CAMPAIGN_CONFIG.startDate,
          endDate: CAMPAIGN_CONFIG.endDate,
          dailyOpenTime: CAMPAIGN_CONFIG.dailyOpenTime,
          dailyDeadline: CAMPAIGN_CONFIG.dailyDeadline,
          leaderboardVisible: CAMPAIGN_CONFIG.leaderboardVisible,
          leaderboardTime: CAMPAIGN_CONFIG.leaderboardTime,
          nameDisplayMode: CAMPAIGN_CONFIG.nameDisplayMode,
          tieBreakRule: CAMPAIGN_CONFIG.tieBreakRule,
          minImages: CAMPAIGN_CONFIG.minImages,
          maxImages: CAMPAIGN_CONFIG.maxImages,
          maxImageBytes: CAMPAIGN_CONFIG.maxImageBytes,
          allowedMimeTypes: JSON.stringify(CAMPAIGN_CONFIG.allowedMimeTypes),
          status: CAMPAIGN_CONFIG.status,
          campaignTracks: {
            create: tracks.map((track) => {
              const rule = CAMPAIGN_CONFIG.tracks[track.slug]!
              return {
                trackId: track.id,
                enabled: rule.enabled,
                dailyPoints: rule.dailyPoints,
                dailyCap: rule.dailyCap,
                campaignCap: rule.campaignCap,
                overallWeight: rule.overallWeight,
              }
            }),
          },
        },
      })

      await recordAudit({
        actorId: null,
        action: 'campaign.create',
        targetType: 'campaign',
        targetId: created.id,
        // 记下来源：这条不是谁在后台点的，是代码里的配置被部署上来
        after: { ...config, source: 'campaign:init' },
      })

      campaignId = created.id

      console.log(`✔ 已创建活动：${created.name}`)
      console.log(`  活动期：${created.startDate} ~ ${created.endDate}`)
      console.log(`  初始状态：${created.status}（到了开始日期会自动转为 active）`)
    } else {
      const current = existing[0]!
      campaignId = current.id

      const changes = diffFields(currentFields(current), config)

      if (changes.length === 0) {
        console.log(`✔ 活动与代码里的配置一致，无需改动：${current.name}`)
        console.log(`  当前状态：${current.status}（脚本不改状态）`)
      } else {
        console.log(`↻ 正在更新活动：${current.name}（状态 ${current.status}，不会被改动）`)
        for (const change of changes) {
          console.log(`  ${change.field}：${describe(change.from)} → ${describe(change.to)}`)
        }

        await prisma.campaign.update({
          where: { id: current.id },
          data: {
            name: CAMPAIGN_CONFIG.name,
            description: CAMPAIGN_CONFIG.description,
            timezone: CAMPAIGN_CONFIG.timezone,
            startDate: CAMPAIGN_CONFIG.startDate,
            endDate: CAMPAIGN_CONFIG.endDate,
            dailyOpenTime: CAMPAIGN_CONFIG.dailyOpenTime,
            dailyDeadline: CAMPAIGN_CONFIG.dailyDeadline,
            leaderboardVisible: CAMPAIGN_CONFIG.leaderboardVisible,
            leaderboardTime: CAMPAIGN_CONFIG.leaderboardTime,
            nameDisplayMode: CAMPAIGN_CONFIG.nameDisplayMode,
            tieBreakRule: CAMPAIGN_CONFIG.tieBreakRule,
            minImages: CAMPAIGN_CONFIG.minImages,
            maxImages: CAMPAIGN_CONFIG.maxImages,
            maxImageBytes: CAMPAIGN_CONFIG.maxImageBytes,
            allowedMimeTypes: JSON.stringify(CAMPAIGN_CONFIG.allowedMimeTypes),
          },
        })

        await recordAudit({
          actorId: null,
          action: 'campaign.update',
          targetType: 'campaign',
          targetId: current.id,
          before: currentFields(current),
          after: { ...config, source: 'campaign:init' },
        })
      }
    }

    // ---- 赛道规则 ----
    // 名单里逐条打出来，因为「哪个赛道多少分」是最容易被改错、
    // 也最不容易在界面上被发现的一项
    let trackChanges = 0
    console.log('')
    console.log('赛道计分规则：')
    for (const track of tracks) {
      const rule = CAMPAIGN_CONFIG.tracks[track.slug]!
      const campaignRecord = await prisma.campaignTrack.findFirst({
        where: { campaignId, trackId: track.id },
      })
      if (!campaignRecord) continue

      const changed =
        campaignRecord.enabled !== rule.enabled ||
        campaignRecord.dailyPoints !== rule.dailyPoints ||
        campaignRecord.dailyCap !== rule.dailyCap ||
        campaignRecord.campaignCap !== rule.campaignCap ||
        campaignRecord.overallWeight !== rule.overallWeight

      if (changed) {
        await prisma.campaignTrack.update({
          where: { id: campaignRecord.id },
          data: {
            enabled: rule.enabled,
            dailyPoints: rule.dailyPoints,
            dailyCap: rule.dailyCap,
            campaignCap: rule.campaignCap,
            overallWeight: rule.overallWeight,
          },
        })
        trackChanges += 1
      }

      console.log(
        `  ${track.name}：每日 ${rule.dailyPoints} 毫点` +
          `${rule.dailyCap === null ? '' : `，每日上限 ${rule.dailyCap}`}` +
          `${rule.campaignCap === null ? '' : `，活动上限 ${rule.campaignCap}`}` +
          `，总榜权重 ${rule.overallWeight}${rule.enabled ? '' : '（已停用）'}`,
      )
    }

    if (trackChanges > 0) {
      console.log(`↻ 更新了 ${trackChanges} 个赛道的计分规则`)
    }

    console.log('')
    console.log('提醒：计分规则改动不会自动刷新已发布的排行榜（§9.2）。')
    console.log('      需要重算时走管理后台的排行榜维护，或 POST /admin/leaderboards/rebuild。')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('')
  console.error('✘ campaign:init 失败')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
