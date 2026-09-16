import { Alert, Input, Modal, Radio, Space, Typography } from 'antd'
import type { RejectReason, RejectReasonCode } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { useHotkeys } from '../hooks/useHotkeys'

/**
 * 驳回面板（design.md §8.2）。
 *
 * 驳回必须填写原因，且原因要能让参赛者看懂自己哪里没做到 ——
 * 因此预设原因是**可选的单选项**而不是必选的枚举：选了「其他」还得补一句说明。
 *
 * 键盘流在这一屏的取舍值得说明：数字键选原因，但它**不允许在输入框内触发**。
 * 原因列表以光标落在列表上开始（不是输入框），此时 1..6 直接选中；
 * 一旦点进补充说明里，数字就老老实实打字 ——
 * 否则「日期 2026 年」这样的说明会在第一个 2 上跳走一个选项。
 */
export interface RejectModalProps {
  open: boolean
  reasons: RejectReason[]
  loading: boolean
  /**
   * 选中与补充说明由**页面**持有。
   *
   * 原因同上（见 ReasonModal）：清空要在「按下 R 打开面板」那个事件里做，
   * 而不是在 effect 里等 open 变成 true —— 那样第一帧画的是上一条记录
   * 的驳回原因，审核员一按 R 就会看到一个不属于这条记录的结论。
   */
  reasonCode: RejectReasonCode | undefined
  onReasonCodeChange: (code: RejectReasonCode) => void
  detail: string
  onDetailChange: (detail: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function RejectModal({
  open,
  reasons,
  loading,
  reasonCode,
  onReasonCodeChange,
  detail,
  onDetailChange,
  onSubmit,
  onCancel,
}: RejectModalProps) {
  const trimmed = detail.trim()
  const needsDetail = reasonCode === 'other'
  const canSubmit = Boolean(reasonCode) && (!needsDetail || trimmed.length > 0) && !loading

  const submit = () => {
    if (!canSubmit) return
    onSubmit()
  }

  useHotkeys(
    [
      // 数字键选原因。列表最多 6 项，与设计文档的预设原因一一对应。
      ...reasons.slice(0, 9).map((reason, index) => ({
        key: String(index + 1),
        handler: () => onReasonCodeChange(reason.code),
      })),
      { key: 'Enter', handler: submit, allowInInput: true },
      { key: 'Escape', handler: onCancel, allowInInput: true },
    ],
    { enabled: open },
  )

  return (
    <Modal
      open={open}
      title={zh.admin.review.rejectTitle}
      okText={zh.admin.review.reject}
      cancelText={zh.admin.common.cancel}
      okButtonProps={{ danger: true, disabled: !canSubmit, loading }}
      onOk={submit}
      onCancel={onCancel}
      maskClosable={false}
      destroyOnHidden
      width={480}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {zh.admin.review.rejectReasonLabel}
      </Typography.Text>

      <Radio.Group
        value={reasonCode}
        onChange={(event) => onReasonCodeChange(event.target.value as RejectReasonCode)}
        style={{ display: 'block', marginTop: 8 }}
      >
        <Space direction="vertical" size={4}>
          {reasons.map((reason, index) => (
            <Radio key={reason.code} value={reason.code}>
              {reason.label}
              {/* 数字键提示：只在列表上标出来，说明栏里不标，避免误以为在那儿也能按 */}
              {index < 9 && (
                <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                  {index + 1}
                </Typography.Text>
              )}
            </Radio>
          ))}
        </Space>
      </Radio.Group>

      <Input
        style={{ marginTop: 12 }}
        maxLength={500}
        placeholder={zh.admin.review.rejectDetailPlaceholder}
        value={detail}
        status={needsDetail && trimmed.length === 0 ? 'error' : undefined}
        onChange={(event) => onDetailChange(event.target.value)}
        onPressEnter={submit}
      />

      {needsDetail && trimmed.length === 0 && (
        <Alert
          type="error"
          showIcon
          banner
          style={{ marginTop: 8 }}
          message={zh.admin.review.rejectDetailRequired}
        />
      )}
    </Modal>
  )
}
