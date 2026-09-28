import { z } from 'zod'
import type { DEFAULT_TRACKS } from '../config/constants.js'
import { validationFailed } from '../core/errors.js'

/**
 * 打卡分值判定（design.md §9.1）。
 *
 * 三个赛道的分值不是固定的：单词按背诵数量、运动按运动类型分档，读书固定为基础分。
 * 判定所需的信息由参赛者在提交时申报，服务端只做校验与判定，**不把分值写回数据库**。
 *
 * ## 为什么分值必须每次现算，而不是提交/审核时算好存起来
 *
 * design.md 的硬性规则是「一个打卡只算一次分」：先交 30 个单词通过审核得 1 分，
 * 管理员重开后改交 50 个单词再通过，总分必须是 2 分而不是 3 分。
 *
 * 这件事成立**完全依赖**下面这条不变量：
 *
 *     分值从 checkin_entries 派生，经 entry.currentRevision 读取，从不从版本累加。
 *
 * 槽位唯一约束 (participant_id, track_id, activity_date) 保证一人一天一赛道只有一条记录；
 * 重新提交只是给这条记录换一个 currentRevision。因此「读当前版本」天然就是「替换」而不是
 * 「累加」——重新通过把旧值换掉，不需要任何额外代码。
 *
 * 所以：**不要给 submission_revisions 加 points 列，也不要把版本分值相加。**
 * 一旦有人「顺手把判好的分缓存到版本上」，上面那条硬性规则会立刻被破坏，
 * 而且是静默破坏——分数看起来正常，只是多算了一次。
 *
 * 分值会不会被每日/活动上限吃掉见 campaign.ts 的 TrackRule 注释。
 */

/** 二档的倍数。刻意不写字面量 2000：分值必须始终相对赛道基础分，随配置一起变 */
export const TIER2_MULTIPLIER = 2

/** 单词赛道计入分值的最少数量。低于它的提交直接被拒，所以库里不该出现这种值 */
export const WORD_COUNT_MIN = 30
/** 单词赛道升到二档的数量 */
export const WORD_COUNT_TIER2 = 50

/**
 * 运动类型。存**稳定的英文码**，中文标签（`>2km跑步` 等）属于文案，
 * 在 frontend/src/locales/zh-CN.ts 里。
 *
 * 把中文存进库的代价是它同时出现在 CSV 导出和审核页里，而且以后改名要洗数据。
 */
export const FITNESS_EXERCISE_TYPES = [
  'run_gt_2km',
  'run_gt_3km',
  'workout_30min',
  'workout_60min',
] as const

export type FitnessExerciseType = (typeof FITNESS_EXERCISE_TYPES)[number]

export const fitnessExerciseTypeSchema = z.enum(FITNESS_EXERCISE_TYPES)

const FITNESS_TIER2_TYPES: readonly string[] = ['run_gt_3km', 'workout_60min'] satisfies FitnessExerciseType[]

export function isFitnessExerciseType(value: string): value is FitnessExerciseType {
  return (FITNESS_EXERCISE_TYPES as readonly string[]).includes(value)
}

type TrackSlug = (typeof DEFAULT_TRACKS)[number]['slug']

/**
 * 图片不是必填材料的赛道。
 *
 * 读书固定 1 分、不看量，所以材料要求也放宽到「图片与备注至少有一个」。
 * 这张表在 resolveDeclaration 里被读，**也只在那里**被读——
 * 不要把它拆成第二个 effectiveMinImages 函数，那会变成两份会各自漂移的读书例外。
 */
export const LENIENT_IMAGE_TRACKS = ['reading'] as const satisfies readonly TrackSlug[]

export function isLenientImageTrack(trackSlug: string): boolean {
  return (LENIENT_IMAGE_TRACKS as readonly string[]).includes(trackSlug)
}

/**
 * 分值会随申报明细分档的赛道。判定逻辑见下面的 judgePoints（它就是按这两个 slug 分支的），
 * 这张表是给申报方与配置校验用的：**这些赛道的 dailyCap 必须 ≥ 差异化下限**，
 * 否则二档会被每日上限静默压掉（见 scoring.service.ts 的 TrackScoringConfig.dailyCap）。
 */
export const TIERED_TRACKS = ['vocabulary', 'fitness'] as const satisfies readonly TrackSlug[]

/**
 * 每日上限会不会把二档压掉。
 *
 * `dailyTotals` 对每天的分值取 `Math.min(points, dailyCap)`，所以上限低于两倍基础分值
 * 时，二档会被**静默**压成基础分 —— 而审核页显示的是判定出来的 2 分，
 * 于是「导出与榜单对不上」（design.md §16.16）以一种极难察觉的方式发生。
 *
 * 上限有**两扇门**：`config/campaign.ts` + `campaign:init`，以及
 * `PATCH /admin/campaigns/tracks/:trackId`。两边都调这个函数，规则只有一份。
 *
 * 返回可读原因，null 表示没问题。刻意不抛错：两个调用方的错误类型不同
 * （一个在建库脚本里，抛 Error；一个是请求，抛 AppError）。
 */
export function dailyCapTierProblem(input: {
  trackSlug: string
  dailyPoints: number
  dailyCap: number | null
}): string | null {
  const { trackSlug, dailyPoints, dailyCap } = input
  if (!(TIERED_TRACKS as readonly string[]).includes(trackSlug)) return null
  if (dailyCap === null) return null

  const required = dailyPoints * TIER2_MULTIPLIER
  if (dailyCap >= required) return null

  return (
    `${trackSlug} 的每日上限（${dailyCap}）低于两倍每日分值（${required}）：` +
    '这会把二档压成基础分，且不会有任何报错。请把它设为不限或至少两倍每日分值。'
  )
}

/** 一条打卡申报的明细。两个字段都可能是 null —— 读书、补录与历史记录都没有 */
export interface CheckinDeclaration {
  wordCount: number | null
  exerciseType: string | null
}

const NO_DECLARATION: CheckinDeclaration = { wordCount: null, exerciseType: null }

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/**
 * 一条打卡值多少分（毫点，1000 = 1 分）。
 *
 * 分支顺序是刻意的：**明细缺失或不认识一律回退 basePoints**。
 * 兜底必须由调用方传进来的 basePoints（= campaign_tracks.daily_points）算，
 * 不能写死 1000 —— 管理员可以把某个赛道的 daily_points 调成别的值，
 * 写死就会和 campaign.ts「规则值唯一来源」的前提打架，
 * 也会让 CSV 导出与排行榜对不上（design.md §16.16）。
 *
 * 这条回退路径是真实存在的，不是防御性代码：历史记录、读书赛道、
 * 管理员补录、以及 daily_points 被调过的赛道都会走它。
 */
export function judgePoints(params: {
  trackSlug: string
  declaration?: CheckinDeclaration | null
  basePoints: number
}): number {
  const { trackSlug, declaration, basePoints } = params
  if (!declaration) return basePoints

  if (trackSlug === 'vocabulary') {
    const count = declaration.wordCount
    // 小于下限的值本不该落库（提交时就拒了），真出现时按基础分算：
    // 人确实背了单词，只是量不够，不该比「没有记录」更差
    if (typeof count !== 'number' || !Number.isInteger(count) || count < WORD_COUNT_MIN) {
      return basePoints
    }
    return count >= WORD_COUNT_TIER2 ? basePoints * TIER2_MULTIPLIER : basePoints
  }

  if (trackSlug === 'fitness') {
    const type = declaration.exerciseType
    if (type === null || !isFitnessExerciseType(type)) return basePoints
    return FITNESS_TIER2_TYPES.includes(type) ? basePoints * TIER2_MULTIPLIER : basePoints
  }

  // 读书与未知赛道：基础分
  return basePoints
}

// ---------------------------------------------------------------------------
// 提交时的校验与归一化
// ---------------------------------------------------------------------------

export interface DeclarationInput {
  trackSlug: string
  wordCount?: number | null | undefined
  exerciseType?: string | null | undefined
  note?: string | null | undefined
  /** 本次提交实际带了几张图 */
  imageCount: number
  /** 活动配置里的图片下限（campaign.minImages） */
  campaignMinImages: number
}

export interface ResolvedDeclaration {
  /** 归一化后的申报明细，直接写进 submission_revisions */
  declaration: CheckinDeclaration
  /** 该赛道本次提交实际生效的图片下限 */
  minImages: number
}

/**
 * 按赛道校验并归一化申报明细，返回要落库的明细与该赛道生效的图片下限。
 *
 * 参赛者提交（submitCheckin）与管理员补录（createManualEntry）**共用这一个函数**：
 * 两条路径的规则必须一致，否则「自己交的 60 分钟运动记 2 分、补录的同一条记 1 分」，
 * 而且没人解释得清为什么。
 *
 * 返回值同时带上 minImages，是因为读书的宽松材料规则与图片下限是同一件事的
 * 两面——拆成两个函数就会有两份会漂移的例外。
 *
 * 这里只做「明确非法才拒」的判定；宽容兜底（历史数据、脏值）由 judgePoints 负责。
 * 校验归校验、兜底归兜底，两件事不要混在一起。
 */
export function resolveDeclaration(input: DeclarationInput): ResolvedDeclaration {
  const { trackSlug, note, imageCount, campaignMinImages } = input

  if (trackSlug === 'vocabulary') {
    const wordCount = input.wordCount ?? null
    if (wordCount === null || !Number.isInteger(wordCount) || wordCount < WORD_COUNT_MIN) {
      throw validationFailed(`单词数量必须是不小于 ${WORD_COUNT_MIN} 的整数`, {
        word_count_min: WORD_COUNT_MIN,
      })
    }
    // 单词赛道只认数量：误传的 exercise_type 在这里被丢弃，
    // 不允许无关字段流到计分器上
    return { declaration: { wordCount, exerciseType: null }, minImages: campaignMinImages }
  }

  if (trackSlug === 'fitness') {
    const exerciseType = input.exerciseType ?? null
    if (exerciseType === null || !isFitnessExerciseType(exerciseType)) {
      throw validationFailed('请选择运动类型', { exercise_types: [...FITNESS_EXERCISE_TYPES] })
    }
    return { declaration: { wordCount: null, exerciseType }, minImages: campaignMinImages }
  }

  if (isLenientImageTrack(trackSlug)) {
    // 读书：图片与备注只要有一个就算交齐了材料。
    // 补录路径没有图片，但它一定会写一版备注（见 admin-ops/service.ts），所以这里也能过。
    if (imageCount === 0 && !hasText(note)) {
      throw validationFailed('请上传证明材料或填写备注，二者至少填一个')
    }
    return { declaration: NO_DECLARATION, minImages: 0 }
  }

  // 其余赛道沿用活动配置的下限
  return { declaration: NO_DECLARATION, minImages: campaignMinImages }
}
