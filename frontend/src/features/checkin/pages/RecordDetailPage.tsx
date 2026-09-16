import { useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Collapse, Descriptions, Image, Result, Skeleton, Space, Tag, Typography } from 'antd'
import { fetchCheckinDetail } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import SignedImage from '@/components/SignedImage'
import { formatActivityDateLong, formatCst } from '@/lib/datetime'
import { paths } from '@/routes/paths'
import { CHECKIN_STATUS_META } from '../statusMeta'

/**
 * 打卡详情（design.md §7.5）。
 *
 * 当前版本展示证明材料、备注与审核结果；历史版本默认折叠在「提交历史」里。
 * 后端返回的 history 本来就不含当前版本，所以「默认折叠」是天然的。
 */
export default function RecordDetailPage() {
  const { entryId = '' } = useParams()
  const navigate = useNavigate()

  const detailQuery = useQuery({
    queryKey: qk.checkinDetail(entryId),
    queryFn: () => fetchCheckinDetail(entryId),
    enabled: Boolean(entryId),
  })

  if (detailQuery.isPending) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="page">
        <Result
          status="warning"
          title="没能加载记录详情"
          subTitle="记录可能已被删除，或网络异常。"
          extra={<Button type="primary" onClick={() => navigate(paths.records)}>返回记录列表</Button>}
        />
      </div>
    )
  }

  const detail = detailQuery.data
  const meta = CHECKIN_STATUS_META[detail.status]
  const assets = detail.current_revision?.assets ?? []

  return (
    <div className="page">
      <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 12 }}>
        <Space size={8}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {detail.track.name}
          </Typography.Title>
          <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
            {meta.label}
          </Tag>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {formatActivityDateLong(detail.activity_date)}
        </Typography.Text>
      </Space>

      {detail.status === 'rejected' && detail.rejection_reason && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="本条记录被驳回"
          description={detail.rejection_reason}
        />
      )}

      {detail.status === 'revoked' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="审核结果已被管理员撤销"
          description="该记录不再计分。如有疑问请联系活动管理员。"
        />
      )}

      {detail.status === 'void' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="该记录已被作废"
          description="如有疑问请联系活动管理员。"
        />
      )}

      {detail.reopen_expires_at && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="管理员已临时重新开放"
          description={`请在此时间前完成重新提交：${formatCst(detail.reopen_expires_at)}`}
        />
      )}

      {/*
        证明要求也在这里给一次 —— 被驳回后回看时，
        用户最需要的就是「到底要求什么样的截图」
      */}
      {detail.track.proof_instructions && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="有效证明要求"
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{detail.track.proof_instructions}</span>}
        />
      )}

      <Card size="small" title="证明材料" style={{ marginBottom: 12 }}>
        {assets.length === 0 ? (
          <Typography.Text type="secondary">本条记录没有证明材料。</Typography.Text>
        ) : (
          // PreviewGroup 提供放大、旋转与左右切换，点任意一张即可进入
          <Image.PreviewGroup>
            <div className="image-grid">
              {assets.map((asset, index) => (
                <div className="image-thumb" key={asset.asset_id}>
                  <SignedImage
                    entryId={detail.entry_id}
                    assetId={asset.asset_id}
                    width={asset.width}
                    height={asset.height}
                    alt={`证明材料 ${index + 1}`}
                    previewable
                  />
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Card>

      <Card size="small" title="提交信息" style={{ marginBottom: 12 }}>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label="提交时间">{formatCst(detail.submitted_at)}</Descriptions.Item>
          <Descriptions.Item label="审核时间">
            {detail.reviewed_at ? formatCst(detail.reviewed_at) : '尚未审核'}
          </Descriptions.Item>
          {detail.current_revision && (
            <Descriptions.Item label="版本">
              第 {detail.current_revision.revision_number} 版
            </Descriptions.Item>
          )}
          {detail.current_revision?.note && (
            <Descriptions.Item label="备注">{detail.current_revision.note}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/*
        历史版本默认折叠（§7.5）。后端返回的 history 本就只含历史版本，
        不含当前版本 —— 所以无需前端再过滤一遍。
      */}
      {detail.history.length > 0 && (
        <Collapse
          size="small"
          items={[
            {
              key: 'history',
              label: `提交历史（${detail.history.length} 个较早版本）`,
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {detail.history.map((revision) => (
                    <div key={revision.revision_number}>
                      <Typography.Text style={{ fontSize: 13 }}>
                        第 {revision.revision_number} 版 · {revision.asset_count} 张
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCst(revision.submitted_at)}
                        {revision.note ? ` · ${revision.note}` : ''}
                      </Typography.Text>
                    </div>
                  ))}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    审核仅以最新一次提交为准。
                  </Typography.Text>
                </Space>
              ),
            },
          ]}
        />
      )}

      <Button block style={{ marginTop: 16, marginBottom: 24 }} onClick={() => navigate(paths.records)}>
        返回记录列表
      </Button>
    </div>
  )
}
