import { Alert, Button, Collapse, Descriptions, Empty, Space, Tag, Timeline, Typography } from 'antd'
import type { ReviewEntryDetail } from '@/api/types'
import { CHECKIN_STATUS_META } from '@/components/entryStatusMeta'
import { formatActivityDateLong, formatCst } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'

/**
 * 审核页右栏：这条记录是什么（design.md §8.2）。
 *
 * 内容全部来自一次 `GET /admin/reviews/{entryId}` —— 面板要一次性画完。
 * 拆成几个接口会让审核员切记录时看到画面逐块跳变，
 * 而这是每秒都在发生的操作。
 */
export interface ContextColumnProps {
  detail: ReviewEntryDetail
  /** 详情里的版本已经和聚焦时冻结的不一致了 */
  isStale: boolean
  onAcceptRefreshed: () => void
}

export default function ContextColumn({ detail, isStale, onAcceptRefreshed }: ContextColumnProps) {
  const meta = CHECKIN_STATUS_META[detail.status]
  const { participant } = detail

  return (
    <div className="review-pipeline__col review-pipeline__col--context">
      {/*
        背景刷新把版本号推高了。不处理的话会出现「看着第 2 版、提交的却是
        第 1 版的版本号」，服务端会判成并发冲突并把审核员的结论丢掉。
      */}
      {isStale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.admin.review.detailStale}
          action={
            <Button size="small" type="primary" onClick={onAcceptRefreshed}>
              {zh.admin.review.detailStaleRefresh}
            </Button>
          }
        />
      )}

      <Space size={8} style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {detail.track.name}
        </Typography.Title>
        <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
          {meta.label}
        </Tag>
        {detail.is_manual && <Tag color="purple">{zh.admin.review.manualBadge}</Tag>}
        {detail.is_resubmission && (
          <Tag color="orange">
            {zh.admin.review.resubmissionBadge(detail.current_revision?.revision_number ?? 0)}
          </Tag>
        )}
      </Space>

      {detail.reopen_expires_at && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.admin.review.reopenNotice(formatCst(detail.reopen_expires_at))}
        />
      )}

      <Descriptions size="small" column={1} bordered styles={{ label: { width: 84 } }}>
        <Descriptions.Item label={zh.admin.review.name}>{participant.name}</Descriptions.Item>
        <Descriptions.Item label={zh.admin.review.studentId}>{participant.student_id}</Descriptions.Item>
        <Descriptions.Item label={zh.admin.review.className}>
          {participant.class_name ?? '—'}
        </Descriptions.Item>
        {/*
          手机尾号与备注是给审核员用的辅助线索（截图内容与本人对不上时），
          没有就不占一行 —— 一整列「—」会把真正有用的信息挤下去
        */}
        {participant.phone_suffix && (
          <Descriptions.Item label={zh.admin.review.phoneSuffix}>
            {participant.phone_suffix}
          </Descriptions.Item>
        )}
        {participant.remark && (
          <Descriptions.Item label={zh.admin.review.remark}>{participant.remark}</Descriptions.Item>
        )}
        <Descriptions.Item label={zh.admin.review.activityDate}>
          {formatActivityDateLong(detail.activity_date)}
        </Descriptions.Item>
        <Descriptions.Item label={zh.admin.review.submittedAt}>
          {formatCst(detail.submitted_at)}
        </Descriptions.Item>
        <Descriptions.Item label={zh.admin.review.revision}>
          {detail.current_revision ? zh.admin.review.revisionN(detail.current_revision.revision_number) : '—'}
        </Descriptions.Item>
      </Descriptions>

      <div className="context-note">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {zh.admin.review.note}
        </Typography.Text>
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
          {detail.current_revision?.note || (
            <Typography.Text type="secondary">{zh.admin.review.noNote}</Typography.Text>
          )}
        </Typography.Paragraph>
      </div>

      <Typography.Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>
        {zh.admin.review.history}
      </Typography.Text>

      {detail.history.review_actions.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={zh.admin.review.noHistory} />
      ) : (
        <Timeline
          items={detail.history.review_actions.map((action) => ({
            // 补录是管理员做的，与参赛者提交无关，用不同颜色区分
            color: action.action === 'approve' ? 'green' : action.action === 'reject' ? 'red' : 'gray',
            children: (
              <div>
                <Typography.Text>
                  {zh.admin.review.actionLabel[action.action] ?? action.action}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {formatCst(action.created_at)}
                </Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {action.reviewer?.name ?? zh.admin.audit.system}
                    {action.reason ? ` · ${action.reason}` : ''}
                  </Typography.Text>
                </div>
              </div>
            ),
          }))}
        />
      )}

      {detail.history.previous_revisions.length > 0 && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'previous',
              label: zh.admin.review.previousRevisions(detail.history.previous_revisions.length),
              children: (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {detail.history.previous_revisions.map((revision) => (
                    <Typography.Text key={revision.revision_number} type="secondary" style={{ fontSize: 12 }}>
                      {zh.admin.review.previousRevisionItem(
                        revision.revision_number,
                        revision.asset_count,
                      )}{' '}
                      · {formatCst(revision.submitted_at)}
                    </Typography.Text>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
