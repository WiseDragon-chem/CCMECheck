import { request } from '../client'
import type { JsonOk } from '../contract'

type CampaignCurrentResult = JsonOk<'/api/v1/campaigns/current', 'get'>

/**
 * 当前活动与赛道规则。
 *
 * 响应里带 `server_time`、`activity_date`、`server_time_of_day` ——
 * 倒计时与「今天是哪个活动日」都以它们为准，设备时钟不可信（design.md §7.3）。
 */
export function fetchCurrentCampaign(): Promise<CampaignCurrentResult> {
  return request<CampaignCurrentResult>('/campaigns/current')
}
