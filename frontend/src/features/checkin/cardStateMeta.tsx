import type { ReactNode } from 'react'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  HourglassOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { TodayCard } from '@/api/types'
import { zh } from '@/locales/zh-CN'

/**
 * 主页面三张赛道卡片的展示状态（design.md §7.3）。
 *
 * 展示状态比后端的 `card_state` 多两个，原因见 resolveCardDisplayState。
 */
export type CardDisplayState =
  | 'before_open'
  | 'can_submit'
  | 'submit_closed'
  | 'pending'
  | 'approved'
  | 'rejected_open'
  | 'rejected_closed'
  | 'missed'
  | 'invalid'

export type CardAction = 'submit' | 'resubmit' | 'detail' | null

export interface CardStateMeta {
  label: string
  icon: ReactNode
  /** 颜色只是三条通道之一，绝不能是唯一的区分手段 */
  color: string
}

/**
 * design.md §7.3 要求卡片状态**同时**通过颜色、图标和文字表达，
 * 以保障色觉障碍用户可识别。
 *
 * 注意这条要求是「三种通道都承载信息」，而不是「每种状态的颜色两两不同」——
 * 硬凑九个互不相同的颜色只会得到一个刺眼的调色板，而且灰度下照样分不清。
 * 因此这里颜色按语义分组（灰=无操作、蓝=可操作、琥珀=等待、绿=完成、红=有问题），
 * 区分主要靠图标与文字。
 *
 * 单测会断言：九个状态的**文字与图标两两不同**，且不存在两个状态
 * 同时共用颜色和图标。
 */
export const CARD_STATE_META: Record<CardDisplayState, CardStateMeta> = {
  before_open: {
    label: zh.checkin.cardState.before_open,
    icon: <ClockCircleOutlined />,
    color: '#8c8c8c',
  },
  can_submit: {
    label: zh.checkin.cardState.can_submit,
    icon: <PlusCircleOutlined />,
    color: '#1677ff',
  },
  // 后端修复后 can_submit 会真实反映活动状态，但卡片仍需解释「为什么不能提交」。
  // 这个状态是设计文档状态表没覆盖的，属于必要补充。
  submit_closed: {
    label: zh.checkin.cardState.submit_closed,
    icon: <MinusCircleOutlined />,
    color: '#8c8c8c',
  },
  pending: {
    label: zh.checkin.cardState.pending,
    icon: <HourglassOutlined />,
    color: '#faad14',
  },
  approved: {
    label: zh.checkin.cardState.approved,
    icon: <CheckCircleFilled />,
    color: '#52c41a',
  },
  rejected_open: {
    label: zh.checkin.cardState.rejected_open,
    icon: <ExclamationCircleFilled />,
    color: '#ff4d4f',
  },
  rejected_closed: {
    label: zh.checkin.cardState.rejected_closed,
    icon: <CloseCircleFilled />,
    color: '#ff4d4f',
  },
  missed: {
    label: zh.checkin.cardState.missed,
    icon: <WarningOutlined />,
    color: '#8c8c8c',
  },
  // 对应后端的 revoked / void —— 被管理员处置的记录。
  // 设计文档 §7.3 的状态表同样没有覆盖这两种结果。
  invalid: {
    label: zh.checkin.cardState.invalid,
    icon: <StopOutlined />,
    color: '#8c8c8c',
  },
}

/**
 * 由后端卡片与活动状态推出展示状态。
 *
 * 为什么不能直接用后端的 `card_state`：
 *
 *   1. `rejected` 同时覆盖「已驳回且未截止」与「已驳回且已截止」两种情况，
 *      两者的可用操作完全不同（能否重新提交），区分依据是 `can_submit`。
 *
 *   2. `can_submit` 现在会考虑活动状态，所以「赛道本身开放、但活动已停止提交」
 *      会表现为 card_state='can_submit' 且 can_submit=false。
 *      直接显示「今日尚未打卡」会让人以为还能打卡，必须单独成一种状态。
 */
export function resolveCardDisplayState(card: TodayCard, campaignStatus: string): CardDisplayState {
  switch (card.card_state) {
    case 'approved':
      return 'approved'
    case 'pending':
      return 'pending'
    case 'missed':
      return 'missed'
    case 'invalid':
      return 'invalid'
    case 'before_open':
      return 'before_open'

    case 'rejected':
      return card.can_submit ? 'rejected_open' : 'rejected_closed'

    case 'can_submit':
      // 窗口开着但活动不接受提交 —— 只能是活动状态的问题
      return card.can_submit ? 'can_submit' : 'submit_closed'

    default: {
      // 契约新增了卡片状态而这里没处理。宁可显示一个保守的「未完成」，
      // 也不要因为一个未映射的值让整页崩掉。
      void campaignStatus
      return 'missed'
    }
  }
}

/**
 * 该状态可用的操作。
 *
 * 单独成函数而不是塞进元数据表，是因为同一个展示状态下操作可能不同：
 *  §7.3 的表格里，「待审核」一行的可用操作是**「截止前可重新提交」**——
 *  也就是说待审核的记录在截止前是允许重交的，截止后就只能查看。
 *  展示文案相同，操作却不同，所以要结合 can_submit 判断。
 */
export function actionFor(card: TodayCard, displayState: CardDisplayState): CardAction {
  switch (displayState) {
    case 'can_submit':
      return 'submit'
    case 'rejected_open':
      return 'resubmit'
    case 'pending':
      // §7.3：待审核在截止前可重新提交，截止后只能查看
      return card.can_submit ? 'resubmit' : 'detail'
    case 'approved':
    case 'rejected_closed':
    case 'invalid':
      return 'detail'
    // 尚未开放、活动已停止提交、当日未完成 —— 都无可操作项
    case 'before_open':
    case 'submit_closed':
    case 'missed':
    default:
      return null
  }
}

export function metaFor(card: TodayCard, campaignStatus: string): CardStateMeta {
  return CARD_STATE_META[resolveCardDisplayState(card, campaignStatus)]
}
