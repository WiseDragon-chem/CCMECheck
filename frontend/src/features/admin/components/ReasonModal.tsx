import type { ReactNode } from 'react'
import { Alert, Input, Modal, Typography } from 'antd'
import { zh } from '@/locales/zh-CN'

/**
 * 「填写原因才能确认」的对话框。
 *
 * §8.5 对管理端的异常操作只有一条硬性要求：**所有异常操作必须填写原因，
 * 并写入审计日志**。服务端已经在 schema 层强制了（admin-ops 要求至少 2 个字符），
 * 因此这里不是「友好提示」而是提前把必然失败的那一次提交挡住。
 *
 * 抽成一个组件是因为管理端有八个操作走同一条路径（补录、重开、撤销、作废、
 * 积分调整、重算、冻结、解冻）。逐个写会让「某个对话框忘了校验原因」
 * 变成一个只能靠点遍所有按钮才发现的问题。
 */
export interface ReasonModalProps {
  open: boolean
  title: string
  /**
   * 这次操作会造成什么。
   *
   * 不可逆的操作必须写在这里 —— 一个只有「确认要作废吗」的对话框，
   * 对第一次用后台的人等于没提示。
   */
  consequence: ReactNode
  confirmText: string
  /** 破坏性操作用红色确认按钮 */
  danger?: boolean
  /** 提交中：按钮转圈并禁止重复提交 */
  loading?: boolean
  /** 原因之外的附加字段（活动日、重开时长、分值…），由调用方持有状态 */
  children?: ReactNode
  /**
   * 原因由**调用方**持有，不在这里存。
   *
   * 这样「每次打开都从空开始」就落在调用方打开对话框的那个事件处理里
   * （见 OpsAction），而不是一个「open 变 true 时清空」的 effect ——
   * 后者会在已经打开的那一帧先闪一次上一次的内容。
   */
  reason: string
  onReasonChange: (reason: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function ReasonModal({
  open,
  title,
  consequence,
  confirmText,
  danger = false,
  loading = false,
  children,
  reason,
  onReasonChange,
  onSubmit,
  onCancel,
}: ReasonModalProps) {
  const trimmed = reason.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < 2
  const canSubmit = trimmed.length >= 2 && !loading

  return (
    <Modal
      open={open}
      title={title}
      okText={confirmText}
      cancelText={zh.admin.common.cancel}
      okButtonProps={{ danger, disabled: !canSubmit, loading }}
      onOk={() => canSubmit && onSubmit()}
      onCancel={onCancel}
      // 关掉点击遮罩关闭：误点一下就把填了一半的原因丢掉，很难不被骂
      maskClosable={false}
      destroyOnHidden
    >
      {consequence}

      {children}

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
        {zh.admin.common.reason}
      </Typography.Text>
      <Input.TextArea
        autoFocus
        rows={2}
        maxLength={500}
        showCount
        value={reason}
        status={tooShort ? 'error' : undefined}
        placeholder={zh.admin.common.reasonPlaceholder}
        onChange={(event) => onReasonChange(event.target.value)}
        style={{ marginTop: 4 }}
      />

      {tooShort && (
        <Alert type="error" showIcon banner style={{ marginTop: 8 }} message={zh.admin.common.reasonTooShort} />
      )}
    </Modal>
  )
}
