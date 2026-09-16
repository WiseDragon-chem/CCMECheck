import { useState, type ReactNode } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { Alert, Button, Card, Skeleton, Space, Tag, Typography } from 'antd'
import type { ReviewEntryDetail } from '@/api/types'
import { CHECKIN_STATUS_META } from '@/components/entryStatusMeta'
import { formatActivityDateLong } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import ReasonModal from './ReasonModal'

/**
 * §8.5 的一个异常操作：说明 + 表单 + 确认。
 *
 * 五个操作（补录、重开、撤销、作废、积分调整）加三个排行榜维护动作
 * 长得一模一样，差别只在表单字段与后果说明。把外壳抽出来，
 * 是为了让「每个操作都必须填原因」这件事只有一处实现 ——
 * 逐个写会让某一个漏掉原因校验，而那正好是最难发现的一种。
 */
export interface OpsActionProps<TBody> {
  title: string
  hint: string
  /** 不可逆后果。写清楚是这一屏存在的主要理由 */
  consequence: string
  confirmText: string
  danger?: boolean
  /** 表单填全了才允许打开确认框 */
  ready: boolean
  /** 用当前表单值 + 原因组成请求体 */
  buildBody: (reason: string) => TBody
  mutation: UseMutationResult<unknown, unknown, TBody>
  /** 操作成功后清空表单，避免同样的值被再提交一次 */
  onDone?: () => void
  children: ReactNode
}

export default function OpsAction<TBody>({
  title,
  hint,
  consequence,
  confirmText,
  danger,
  ready,
  buildBody,
  mutation,
  onDone,
  children,
}: OpsActionProps<TBody>) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const openModal = () => {
    // 打开时清空上一次的原因。放在这里而不是「open 变 true」的 effect 里 ——
    // 上一份原因被顺手带到下一次操作，会写出一条内容对不上的审计记录，
    // 而 effect 版本的清空在视觉上还会先闪一下旧内容
    setReason('')
    setOpen(true)
  }

  return (
    <Card
      size="small"
      title={title}
      extra={
        <Button
          size="small"
          danger={danger}
          type={danger ? 'default' : 'primary'}
          disabled={!ready}
          onClick={openModal}
        >
          {confirmText}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {hint}
      </Typography.Paragraph>

      {children}

      <ReasonModal
        open={open}
        title={title}
        consequence={
          <Alert
            type={danger ? 'error' : 'warning'}
            showIcon
            message={consequence}
            style={{ marginBottom: 4 }}
          />
        }
        confirmText={confirmText}
        danger={danger}
        loading={mutation.isPending}
        reason={reason}
        onReasonChange={setReason}
        onSubmit={() =>
          mutation.mutate(buildBody(reason.trim()), {
            onSuccess: () => {
              setOpen(false)
              onDone?.()
            },
            // 失败时对话框留着，填过的原因与表单值都还在 ——
            // 管理员改一处就能重试，不必从头再填一遍
          })
        }
        onCancel={() => setOpen(false)}
      />
    </Card>
  )
}

/** 表单里的一行：标签 + 控件。管理端的表单字段多，统一间距比逐处写 style 可靠 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <Typography.Text style={{ fontSize: 13 }}>{label}</Typography.Text>
      {hint && (
        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
          {hint}
        </Typography.Text>
      )}
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

/**
 * 按 ID 查到的那条记录的摘要。
 *
 * 三个按 ID 操作（重开、撤销、作废）共用它。存在的意义是「先看清再动手」：
 * 重开/撤销/作废都要回传 version，也就是说必须先真的把这条记录取回来 ——
 * 既然如此，就没有理由不把它显示给管理员看。
 */
export function EntryPreview({
  detail,
  isLoading,
  isError,
  onRefresh,
  statusHint,
}: {
  detail: ReviewEntryDetail | null
  isLoading: boolean
  isError: boolean
  onRefresh: () => void
  /** 状态不适用时的说明，例如「撤销只对已通过的记录有效」 */
  statusHint?: ReactNode
}) {
  if (isLoading) {
    return (
      <div style={{ marginBottom: 10 }}>
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      </div>
    )
  }

  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 10 }}
        message={zh.admin.ops.entryNotFound}
        description={zh.admin.ops.entryNotFoundDetail}
      />
    )
  }

  if (!detail) return null

  const meta = CHECKIN_STATUS_META[detail.status]

  return (
    <div className="op-entry-preview">
      <Space size={6} wrap>
        <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
          {meta.label}
        </Tag>
        <Typography.Text strong>{detail.participant.name}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {detail.participant.student_id}
          {detail.participant.class_name ? ` · ${detail.participant.class_name}` : ''}
        </Typography.Text>
      </Space>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {detail.track.name} · {formatActivityDateLong(detail.activity_date)} · v{detail.version}
        </Typography.Text>
        <Typography.Link style={{ fontSize: 12, marginLeft: 8 }} onClick={onRefresh}>
          {zh.admin.common.refresh}
        </Typography.Link>
      </div>
      {statusHint && (
        <div>
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            {statusHint}
          </Typography.Text>
        </div>
      )}
    </div>
  )
}
