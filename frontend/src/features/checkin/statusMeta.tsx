import type { ReactNode } from 'react'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  HourglassOutlined,
  RollbackOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { CheckinListItem } from '@/api/types'

/**
 * 打卡记录的状态展示（design.md §6.4 的五种状态）。
 *
 * 与主页面卡片的 `cardStateMeta` 是两套东西，不要合并：
 *   * 卡片要针对「今天」表达可用操作，所以把 rejected 拆成未截止/已截止，
 *     还多出 before_open、missed、submit_closed 这些与操作相关的状态；
 *   * 记录页展示的是历史记录本身的结论，直接对应后端的 entry status。
 *
 * 但两者的纪律一致：状态**同时**用颜色、图标和文字表达（§7.3），
 * 保证色觉障碍用户可识别。
 */
export type EntryStatusKey = CheckinListItem['status']

export interface StatusMeta {
  label: string
  icon: ReactNode
  color: string
}

export const CHECKIN_STATUS_META: Record<EntryStatusKey, StatusMeta> = {
  pending: { label: '待审核', icon: <HourglassOutlined />, color: '#faad14' },
  approved: { label: '已通过', icon: <CheckCircleFilled />, color: '#52c41a' },
  rejected: { label: '已驳回', icon: <CloseCircleFilled />, color: '#ff4d4f' },
  revoked: { label: '已撤销', icon: <RollbackOutlined />, color: '#d46b08' },
  void: { label: '已作废', icon: <StopOutlined />, color: '#8c8c8c' },
}
