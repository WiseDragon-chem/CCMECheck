import type { Track } from '@/api/types'
import { zh } from '@/locales/zh-CN'

/**
 * 排行榜上方那行常驻的算分说明。
 *
 * 说明必须跟着**真实配置**走，不能写死「一次 1 分」。分数是服务端按
 * campaign_tracks 表里的 daily_points / daily_cap / campaign_cap /
 * overall_weight 算出来的，默认值恰好是全等权
 * （见 server/src/config/campaign.ts 的 DEFAULT_TRACK_RULE）。
 * 写死的话，配置一旦调整，界面就开始骗人，而且不会有任何报错提醒。
 *
 * 因此只认全等权这一种配置；其余情况给一句不含数字的兜底 ——
 * 说得笼统好过说得具体但说错。
 *
 * ## 关于「每次 1–2 分」这句里的数字
 *
 * 上面那条「不写死数字」的规则管的是**配置**（daily_points 等，管理员能改）。
 * 分值梯度不在配置里，它写在代码里（server/src/services/judge.service.ts），
 * 所以描述它的文案也只能写在代码里（zh.leaderboard.scoringRule）。
 * 这两处必须同一次改动一起改 —— 改了梯度表却没改文案，这里不会有任何提示，
 * 因为 `isEqualWeight` 看到的 daily_points 仍然是 1000（它现在只是兜底分值）。
 */

/** 千分点，1000 = 1 分 */
const POINT_SCALE = 1000
/** 千分比，1000 = 1.0 倍权重 */
const FULL_WEIGHT = 1000

/** 单个赛道是否是「一次打卡 1 分、不封顶、权重 1.0」 */
function isEqualWeight(track: Track): boolean {
  return (
    track.daily_points === POINT_SCALE &&
    track.daily_cap === null &&
    track.campaign_cap === null &&
    track.overall_weight === FULL_WEIGHT
  )
}

/**
 * 只统计**启用**的赛道：停用的赛道不出现在榜单上，也不参与总榜折算，
 * 把它的条数算进「一天几条赛道」会让说明对不上眼前的标签页。
 */
export function explainScoring(tracks: Track[]): string {
  const enabled = tracks.filter((track) => track.enabled)

  if (enabled.length > 0 && enabled.every(isEqualWeight)) {
    return zh.leaderboard.scoringRule(enabled.length)
  }

  return zh.leaderboard.scoringFallback
}
