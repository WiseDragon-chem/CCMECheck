import { Button, Card, Space, Tag, Typography } from 'antd'
import { formatMilli } from '@/lib/milli'
import { zh } from '@/locales/zh-CN'
import { CARD_STATE_META, actionFor, type CardDisplayState } from '../cardStateMeta'
import type { TodayCard } from '@/api/types'

/**
 * 单个赛道卡片（design.md §7.3）。
 *
 * 卡片要点：赛道名与图标、当日状态、截止时间、累计有效天数、
 * 当前赛道积分、操作按钮、驳回原因或审核提示。
 */

/** `icon` 是后端给的自由字符串，必须带兜底 —— antd 也没有跑步图标 */
function trackIcon(slug: string): string {
  const icons: Record<string, string> = {
    reading: '📖',
    vocabulary: '🔤',
    fitness: '🏃',
  }
  return icons[slug] ?? zh.checkin.trackIconFallback
}

export interface TrackCardProps {
  card: TodayCard
  displayState: CardDisplayState
  /** 距今日截止的秒数；null 表示没有可展示的截止时间 */
  secondsToDeadline: number | null
  deadlineText: string
  onAction: (action: 'submit' | 'resubmit' | 'detail', card: TodayCard) => void
}

export default function TrackCard({
  card,
  displayState,
  secondsToDeadline,
  deadlineText,
  onAction,
}: TrackCardProps) {
  const meta = CARD_STATE_META[displayState]
  // 操作单独推导：同一个展示状态下操作可能不同（见 actionFor 的说明）
  const action = actionFor(card, displayState)

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderLeft: `3px solid ${meta.color}` }}
      styles={{ body: { padding: 14 } }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={8}>
            <span style={{ fontSize: 20 }} aria-hidden>
              {trackIcon(card.slug)}
            </span>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {card.name}
            </Typography.Text>
          </Space>

          {/*
            状态同时用颜色、图标和文字表达（§7.3 的无障碍要求）。
            只用颜色的话，色觉障碍用户与灰度打印都区分不出来。
          */}
          <Tag
            color={meta.color}
            icon={meta.icon}
            style={{ marginInlineEnd: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {meta.label}
          </Tag>
        </div>

        {/* 驳回原因必须原样展示给参赛者（§7.3、§16.6） */}
        {displayState === 'rejected_open' && card.rejection_reason && (
          <Typography.Text style={{ color: '#ff4d4f', fontSize: 13 }}>
            {zh.checkin.home.rejectionPrefix(card.rejection_reason ?? '')}
          </Typography.Text>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {zh.checkin.home.validDaysAndScore(card.valid_days, formatMilli(card.track_score))}
          </Typography.Text>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {secondsToDeadline !== null && secondsToDeadline > 0
              ? zh.checkin.home.deadlineCountdownHint(deadlineText)
              : zh.checkin.home.deadlineHint(deadlineText)}
          </Typography.Text>
        </div>

        {action && (
          <Button
            type={action === 'detail' ? 'default' : 'primary'}
            block
            onClick={() => onAction(action, card)}
          >
            {action === 'submit' ? zh.checkin.cardAction.submit : action === 'resubmit' ? zh.checkin.cardAction.resubmit : zh.checkin.cardAction.detail}
          </Button>
        )}
      </Space>
    </Card>
  )
}
