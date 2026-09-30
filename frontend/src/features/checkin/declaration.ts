/**
 * 打卡申报明细的前端镜像（design.md §9.1）。
 *
 * 服务端是权威判定方（server/src/services/judge.service.ts），这里只镜像
 * **码与阈值**，用来渲染表单与做提交前的即时校验 —— 让用户在点提交之前就
 * 知道还差什么，而不是被服务端拒一次。
 *
 * ## 刻意不镜像的东西
 *
 * **分值表不在这里**，提交页也不显示「填 50 个得 2 分」。分值只在审核页出现，
 * 而且是服务端算好返回的 judged_points。镜像分值就会有两份会各自漂移的规则，
 * 漂移的表现是「页面说 2 分、榜单记 1 分」这种没人会立刻发现的事。
 *
 * 码与阈值也有漂移风险，但后果是可见的：服务端会拒掉它不认识的码并给出可读错误，
 * 审核页遇到未知码会显示原码而不是空白。
 */

/** 单词赛道计入分值的最少数量。与 judge.service.ts 的 WORD_COUNT_MIN 一致 */
export const WORD_COUNT_MIN = 30

/** 单词赛道升到二档的数量。提交页不显示它，只用于表单校验的语义完整 */
export const WORD_COUNT_TIER2 = 50

/**
 * 单词赛道允许申报的最大数量。与 judge.service.ts 的 WORD_COUNT_MAX 一致。
 *
 * 它不是分值档位（≥50 已经封顶在二档），只用来在提交前拦下明显不真实的数量 ——
 * 否则超限的值要等服务端拒一次才知道，而超大值在服务端还会撞上 32 位 Int。
 */
export const WORD_COUNT_MAX = 5000

/** 运动类型，值与 judge.service.ts 的 FITNESS_EXERCISE_TYPES 一致 */
export const FITNESS_EXERCISE_TYPES = [
  'run_gt_2km',
  'run_gt_3km',
  'workout_30min',
  'workout_60min',
] as const

export type FitnessExerciseType = (typeof FITNESS_EXERCISE_TYPES)[number]

/** 是否需要填申报明细的赛道 */
export function requiresDeclaration(slug: string): boolean {
  return slug === 'vocabulary' || slug === 'fitness'
}

/**
 * 图片不是必填材料的赛道：**图片与备注有一个就算交齐**。
 *
 * 与服务端 resolveDeclaration 的 LENIENT_IMAGE_TRACKS 是同一件事的两面。
 * 注意活动配置里的 min_images 没有跟着变（它会被渲染成「1–3 张」的规则摘要），
 * 所以读书页仍写着「1–3 张」而实际允许 0 张 —— 这是知情的取舍：
 * 改 min_images 会连带放开单词与运动的材料要求，代价远大于一句文案的精度。
 */
export function isLenientImageTrack(slug: string): boolean {
  return slug === 'reading'
}

// 运动类型的**中文标签**不在这里 —— 它是文案，归 @/components/exerciseTypeMeta.ts，
// 因为提交页与审核页要显示同一份标签。
