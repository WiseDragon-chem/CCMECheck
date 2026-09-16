import type { CampaignStatus, NameDisplayMode, TieBreakRule } from './constants.js'

/**
 * 当前活动与全部计分规则的**唯一来源**。
 *
 * 刻意写在代码里，而不是做成后台可配置的界面：
 *
 *   1. **改动要留痕。** 改分值、改权重会影响已经发布的排行榜，属于需要
 *      被看见的动作。走代码就意味着它出现在一次提交、一次评审和一次
 *      部署里；而一个后台输入框改完之后，除了审计表里的一行谁也不会知道。
 *   2. **没有第二份事实。** 计分规则分散在「库里的值」和「代码里怎么用它」
 *      两处时，对不上是迟早的事，而且对不上时没有任何报错 —— 只是分数不对。
 *   3. **这是一次性活动。** 配置界面的开发、测试与权限面，换不来几次使用。
 *
 * 代价是明确的：**改任何一项都要重新部署**。日期与每日截止时间也在其中 ——
 * 活动中途要延期也得走一次部署。这是知情的取舍，不是遗漏。
 *
 * 改完这里之后运行 `npm run campaign:init` 应用（幂等，会打印出改了什么）。
 */

/** 单个赛道的计分规则。金额一律是**整数毫点**（1000 = 1 分），权重是整数千分比 */
export interface TrackRule {
  /** 是否开放打卡。停用后参赛者看不到这个赛道 */
  enabled: boolean
  /** 每次审核通过的得分 */
  dailyPoints: number
  /** 每日得分上限；null = 不限 */
  dailyCap: number | null
  /** 整个活动的得分上限；null = 不限 */
  campaignCap: number | null
  /** 总榜权重。1000 = 等权，2000 = 双倍计入总榜 */
  overallWeight: number
}

export interface CampaignConfig {
  name: string
  description: string | null
  timezone: string
  /**
   * 活动起止日期（北京时间，`YYYY-MM-DD`，含首尾）。
   *
   * **留空时 `campaign:init` 会拒绝执行** —— 这不是偷懒的默认值，
   * 而是一个必须由人来填的空。写一个看起来合理的日期（比如国庆那几天）
   * 危险得多：没人会注意到它其实没被确认过，而活动窗口错了会让
   * 所有人的打卡被判成「不在活动期内」。
   */
  startDate: string
  endDate: string
  /** 每日开放时刻 */
  dailyOpenTime: string
  /** 每日截止时刻。超过它普通用户不能提交，只能由管理员重开或补录 */
  dailyDeadline: string
  /** 排行榜是否对参赛者可见 */
  leaderboardVisible: boolean
  /** 每日排行榜快照的生成时刻（§9.2） */
  leaderboardTime: string
  /** 榜单显示真实姓名还是脱敏姓名 */
  nameDisplayMode: NameDisplayMode
  /** 同分处理规则（§9.3） */
  tieBreakRule: TieBreakRule
  minImages: number
  maxImages: number
  maxImageBytes: number
  allowedMimeTypes: string[]
  /**
   * 创建时的初始状态。
   *
   * `published` 而不是 `draft`：状态流转任务会在北京时间跨过开始日期时
   * 自动把它变成 active。脚本驱动的初始化没有「先在后台看一眼再发布」
   * 这一步，代码评审就是那一步。
   */
  status: CampaignStatus
  /** 按赛道 slug 索引的计分规则。slug 与 prisma/seed.ts 里的 DEFAULT_TRACKS 对应 */
  tracks: Record<string, TrackRule>
}

/**
 * 三个赛道的默认规则：每天 1 分、不设上限、总榜等权。
 *
 * design.md §18 把「每个赛道的默认每日分值、积分上限和总榜权重」列为
 * 上线前待确认项 —— 也就是说下面这些数字**是系统默认值，不是最终规则**。
 * 确认真实规则之后直接改这里，然后跑一次 `campaign:init`。
 */
const DEFAULT_TRACK_RULE: TrackRule = {
  enabled: true,
  dailyPoints: 1000,
  dailyCap: null,
  campaignCap: null,
  overallWeight: 1000,
}

export const CAMPAIGN_CONFIG: CampaignConfig = {
  name: '北京大学化学与分子工程学院国庆打卡活动',
  description: null,
  timezone: 'Asia/Shanghai',

  // TODO(上线前必须确认)：design.md §18 第 1 项。留空则脚本拒绝执行
  startDate: '',
  endDate: '',

  dailyOpenTime: '00:00',
  dailyDeadline: '23:59',
  leaderboardVisible: true,
  leaderboardTime: '06:00',
  nameDisplayMode: 'real',
  tieBreakRule: 'score_desc_valid_days_desc_reached_at_asc',
  minImages: 1,
  maxImages: 3,
  maxImageBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  status: 'published',

  tracks: {
    reading: { ...DEFAULT_TRACK_RULE },
    vocabulary: { ...DEFAULT_TRACK_RULE },
    fitness: { ...DEFAULT_TRACK_RULE },
  },
}

/** 活动配置里会被 `campaign:init` 写入库的字段（用于生成「改了什么」的对照） */
export function applyableFields(config: CampaignConfig): Record<string, unknown> {
  return {
    name: config.name,
    description: config.description,
    timezone: config.timezone,
    start_date: config.startDate,
    end_date: config.endDate,
    daily_open_time: config.dailyOpenTime,
    daily_deadline: config.dailyDeadline,
    leaderboard_visible: config.leaderboardVisible,
    leaderboard_time: config.leaderboardTime,
    name_display_mode: config.nameDisplayMode,
    tie_break_rule: config.tieBreakRule,
    min_images: config.minImages,
    max_images: config.maxImages,
    max_image_bytes: config.maxImageBytes,
    allowed_mime_types: config.allowedMimeTypes,
  }
}

/**
 * 配置校验。在写库之前跑，且**只认人来填的值** ——
 * 见 startDate 的说明：留空时这里会拦下，脚本不会用默认日期建活动。
 *
 * 抽成纯函数是为了能单独测：这些分支在真实部署里只会走一次，
 * 而走错一次就是整个活动期的打卡窗口都不对。
 */
export function validateCampaignConfig(config: CampaignConfig = CAMPAIGN_CONFIG): void {
  const missing: string[] = []
  if (!config.startDate) missing.push('startDate')
  if (!config.endDate) missing.push('endDate')

  if (missing.length > 0) {
    throw new Error(
      `活动配置还没填完：${missing.join('、')}。\n` +
        '这些值必须由人确认（design.md §18），这里刻意不提供默认值 —— ' +
        '一个看起来合理的日期比一个空字符串危险得多。\n' +
        '请编辑 src/config/campaign.ts 后重新运行。',
    )
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  for (const key of ['startDate', 'endDate'] as const) {
    if (!datePattern.test(config[key])) {
      throw new Error(`${key} 必须是 YYYY-MM-DD：${config[key]}`)
    }
  }
  if (config.startDate > config.endDate) {
    throw new Error(`开始日期不能晚于结束日期：${config.startDate} > ${config.endDate}`)
  }
  if (config.minImages > config.maxImages) {
    throw new Error(`最少图片数不能大于最多图片数：${config.minImages} > ${config.maxImages}`)
  }
}

/** 一道字段变更。脚本据此打印「改了什么」 */
export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

/**
 * 逐字段对照。
 *
 * 用 JSON 序列化比较而不是 `Object.is`：允许的 MIME 类型是一个数组，
 * 而数组每次读取都是新引用 —— 用引用比较会把「没变」判成「变了」，
 * 于是每次部署都打印一堆假的变更。
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [field, next] of Object.entries(after)) {
    const previous = before[field]
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ field, from: previous, to: next })
    }
  }
  return changes
}
