import { FITNESS_EXERCISE_TYPES, type FitnessExerciseType } from '@/features/checkin/declaration'
import { zh } from '@/locales/zh-CN'

/**
 * 运动类型的展示名（design.md §9.1）。
 *
 * 放在 components 而不是某个 feature 里，理由与 `entryStatusMeta` 相同：
 * 参赛者提交页与管理员审核页要的是同一张表。「>3km跑步」在填表的人眼里和
 * 在审核的人眼里是同一件事，两处各写一份迟早会一边改了名、另一边还显示旧文案。
 *
 * 码（run_gt_2km 等）是逻辑，归 features/checkin/declaration.ts；
 * 中文标签是文案，归 zh-CN.ts。这里只做两者的对接。
 */

const LABELS = zh.checkin.exerciseTypes as Record<string, string | undefined>

/**
 * 未知码**回退显示原码**，不返回空串也不抛错：
 * 服务端加了新选项而前端还没跟上时，审核页显示 `run_gt_5km` 是难看但可用的，
 * 显示空白则会让审核员以为这条没填。
 */
export function exerciseTypeLabel(code: string): string {
  return LABELS[code] ?? code
}

/** 下拉与单选组用的选项列表 */
export function exerciseTypeOptions(): Array<{ value: FitnessExerciseType; label: string }> {
  return FITNESS_EXERCISE_TYPES.map((code) => ({ value: code, label: exerciseTypeLabel(code) }))
}
