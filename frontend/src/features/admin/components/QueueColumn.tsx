import { Button, DatePicker, Empty, Input, Select, Skeleton, Tag, Typography } from 'antd'
import type { ReviewProgress, ReviewQueueEntry, Track } from '@/api/types'
import { formatActivityDate, fromPickerDate, toPickerDate } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'

/**
 * 审核页左栏：筛选、队列与进度（design.md §8.2）。
 *
 * 队列本身刻意**不在这里取数** —— 它由页面持有，因为键盘流需要在
 * 「审完一条之后立刻算出下一条是谁」，那件事发生在比这一栏更高的地方。
 * 这里只负责把给定的顺序画出来。
 */
/**
 * 写成 type 而不是 interface 是有原因的：查询键工厂的参数是
 * `Record<string, unknown>`，而 interface 没有隐式索引签名，赋值会报错。
 * 对象类型别名有。这一条差别只有在把它交给查询键时才看得见。
 */
export type ReviewFilters = {
  track?: string
  activity_date?: string
  class_name?: string
}

export interface QueueColumnProps {
  tracks: Track[]
  filters: ReviewFilters
  onFiltersChange: (filters: ReviewFilters) => void
  /** 已按本次会话的「已决」过滤过的队列 */
  entries: ReviewQueueEntry[]
  /** 整场活动的进度，不受筛选影响 */
  progress: ReviewProgress | undefined
  cursorId: string | null
  onSelect: (entryId: string) => void
  isLoading: boolean
  hasMore: boolean
}

export default function QueueColumn({
  tracks,
  filters,
  onFiltersChange,
  entries,
  progress,
  cursorId,
  onSelect,
  isLoading,
  hasMore,
}: QueueColumnProps) {
  const hasFilters = Boolean(filters.track || filters.activity_date || filters.class_name)
  const pendingTotal = progress?.pending_total ?? 0

  return (
    <div className="review-pipeline__col review-pipeline__col--queue">
      <div className="queue-filters">
        <Select
          allowClear
          size="small"
          style={{ width: '100%' }}
          placeholder={zh.admin.review.allTracks}
          value={filters.track}
          onChange={(track: string | undefined) => onFiltersChange({ ...filters, track })}
          options={tracks.map((track) => ({ value: track.slug, label: track.name }))}
        />
        <DatePicker
          size="small"
          style={{ width: '100%' }}
          placeholder={zh.admin.review.filterDate}
          // 活动日是 date-only 文本，用 toPickerDate 做转换，
          // 不把 'YYYY-MM-DD' 交给 Date 解析（见 lib/datetime 的三条铁律）
          value={toPickerDate(filters.activity_date)}
          onChange={(value) => onFiltersChange({ ...filters, activity_date: fromPickerDate(value) })}
        />
        <Input
          size="small"
          allowClear
          placeholder={zh.admin.review.allClasses}
          value={filters.class_name ?? ''}
          onChange={(event) =>
            onFiltersChange({ ...filters, class_name: event.target.value || undefined })
          }
        />
      </div>

      <ProgressBar progress={progress} />

      <div className="queue-list">
        {isLoading && entries.length === 0 ? (
          <div style={{ padding: 12 }}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                /*
                  两种「空」必须分开说：队列真的清空了，和筛选条件把队列筛空了。
                  后者如果不解释，管理员会以为活干完了而直接下班。
                */
                pendingTotal > 0
                  ? zh.admin.review.queueEmptyFiltered(pendingTotal)
                  : zh.admin.review.queueEmpty
              }
            >
              {pendingTotal > 0 && hasFilters && (
                <Button size="small" onClick={() => onFiltersChange({})}>
                  {zh.admin.review.clearFilters}
                </Button>
              )}
            </Empty>
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <QueueItem
                key={entry.entry_id}
                entry={entry}
                current={entry.entry_id === cursorId}
                onClick={() => onSelect(entry.entry_id)}
              />
            ))}
            {hasMore && (
              <div className="queue-more">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {zh.admin.common.loadingMore}
                </Typography.Text>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function QueueItem({
  entry,
  current,
  onClick,
}: {
  entry: ReviewQueueEntry
  current: boolean
  onClick: () => void
}) {
  return (
    <div
      className={`queue-item${current ? ' is-current' : ''}`}
      onClick={onClick}
      /*
        队列项要能用键盘到达 —— 它承担的是「跳着审」这个真实需求
        （比如管理员只想审某个班的）。箭头键的焦点移动是原生行为，
        这里只需要把语义补上。
      */
      role="button"
      tabIndex={0}
      aria-current={current}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="queue-item__name">
        <Typography.Text strong ellipsis style={{ maxWidth: 180 }}>
          {entry.participant.name}
        </Typography.Text>
        {entry.is_resubmission && (
          <Tag color="orange" style={{ marginInlineEnd: 0 }}>
            {zh.admin.review.resubmissionBadge(entry.revision_number)}
          </Tag>
        )}
      </div>
      <div className="queue-item__meta">
        {entry.track.name} · {formatActivityDate(entry.activity_date)}
      </div>
      <div className="queue-item__meta">
        {entry.participant.class_name ?? '—'} · {entry.participant.student_id}
      </div>
    </div>
  )
}

function ProgressBar({ progress }: { progress: ReviewProgress | undefined }) {
  if (!progress) return null

  return (
    <div className="queue-progress">
      <div className="queue-progress__row">
        <ProgressCell label={zh.admin.review.progressPending} value={progress.pending_total} />
        <ProgressCell label={zh.admin.review.progressReviewed} value={progress.reviewed_today} />
        <ProgressCell label={zh.admin.review.progressApproved} value={progress.approved_today} />
        <ProgressCell label={zh.admin.review.progressRejected} value={progress.rejected_today} />
      </div>
      {/*
        §8.2 的进度衡量「还剩多少活」，因此它不随左侧筛选变化。
        不说明的话，筛到某个赛道看到进度没变会被当成 bug。
      */}
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {zh.admin.review.progressNote}
      </Typography.Text>
    </div>
  )
}

function ProgressCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="queue-progress__cell">
      <span className="queue-progress__value">{value}</span>
      <span className="queue-progress__label">{label}</span>
    </div>
  )
}
