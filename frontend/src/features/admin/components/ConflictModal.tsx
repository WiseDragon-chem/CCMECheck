import { Modal, Typography } from 'antd'
import { zh } from '@/locales/zh-CN'

/**
 * 审核冲突（design.md §8.2 末段）。
 *
 * 两个管理员同时打开同一条时，后提交的人会拿到 409 REVIEW_CONFLICT。
 * 这里**不能自动重试** —— 重试等于用后提交者的结论覆盖先提交者的，
 * 而先提交的那个人可能正是看清楚了材料的那位。
 *
 * 两个出口都对应真实的处置方式：刷新（再看一遍当前版本后决定），
 * 或者跳走（这条别人已经审了，我不必再管）。
 */
export interface ConflictModalProps {
  open: boolean
  /** 服务端当前的版本号，用来告诉审核员「你看到的是哪一版之前的」 */
  currentVersion: number | null
  loading: boolean
  onRefresh: () => void
  onSkip: () => void
}

export default function ConflictModal({
  open,
  currentVersion,
  loading,
  onRefresh,
  onSkip,
}: ConflictModalProps) {
  return (
    <Modal
      open={open}
      title={zh.admin.review.conflictTitle}
      okText={zh.admin.review.conflictRefresh}
      cancelText={zh.admin.review.conflictSkip}
      okButtonProps={{ loading }}
      onOk={onRefresh}
      onCancel={onSkip}
      maskClosable={false}
      closable={false}
    >
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        {zh.admin.review.conflictDetail(currentVersion ?? 0)}
      </Typography.Paragraph>
    </Modal>
  )
}
