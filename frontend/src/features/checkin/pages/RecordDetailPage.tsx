import { useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Collapse, Descriptions, Image, Result, Skeleton, Space, Tag, Typography } from 'antd'
import { fetchCheckinDetail } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import SignedImage from '@/components/SignedImage'
import { formatActivityDateLong, formatCst } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
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
          title={zh.checkin.detail.loadFailed}
          subTitle={zh.checkin.detail.loadFailedDetail}
          extra={<Button type="primary" onClick={() => navigate(paths.records)}>{zh.common.backToRecords}</Button>}
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
          message={zh.checkin.detail.rejectedTitle}
          description={detail.rejection_reason}
        />
      )}

      {detail.status === 'revoked' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.checkin.detail.revokedTitle}
          description={zh.checkin.detail.revokedDetail}
        />
      )}

      {detail.status === 'void' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.checkin.detail.voidTitle}
          description={zh.checkin.detail.voidDetail}
        />
      )}

      {detail.reopen_expires_at && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.checkin.detail.reopenTitle}
          description={zh.checkin.detail.reopenDetail(formatCst(detail.reopen_expires_at))}
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
          message={zh.checkin.submit.proofRequirement}
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{detail.track.proof_instructions}</span>}
        />
      )}

      <Card size="small" title={zh.checkin.submit.materials} style={{ marginBottom: 12 }}>
        {assets.length === 0 ? (
          <Typography.Text type="secondary">{zh.checkin.detail.noAssets}</Typography.Text>
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
                    alt={zh.checkin.submit.proofAlt(index)}
                    previewable
                  />
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Card>

      <Card size="small" title={zh.checkin.detail.submitInfo} style={{ marginBottom: 12 }}>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={zh.checkin.detail.submittedAt}>{formatCst(detail.submitted_at)}</Descriptions.Item>
          <Descriptions.Item label={zh.checkin.detail.reviewedAt}>
            {detail.reviewed_at ? formatCst(detail.reviewed_at) : zh.checkin.detail.notReviewed}
          </Descriptions.Item>
          {detail.current_revision && (
            <Descriptions.Item label={zh.checkin.detail.revision}>
              {zh.checkin.detail.revisionN(detail.current_revision.revision_number)}
            </Descriptions.Item>
          )}
          {detail.current_revision?.note && (
            <Descriptions.Item label={zh.checkin.detail.note}>{detail.current_revision.note}</Descriptions.Item>
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
              label: zh.checkin.detail.history(detail.history.length),
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {detail.history.map((revision) => (
                    <div key={revision.revision_number}>
                      <Typography.Text style={{ fontSize: 13 }}>
                        {zh.checkin.detail.historyItem(revision.revision_number, revision.asset_count)}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCst(revision.submitted_at)}
                        {revision.note ? ` · ${revision.note}` : ''}
                      </Typography.Text>
                    </div>
                  ))}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {zh.checkin.detail.historyLatestOnly}
                  </Typography.Text>
                </Space>
              ),
            },
          ]}
        />
      )}

      <Button block style={{ marginTop: 16, marginBottom: 24 }} onClick={() => navigate(paths.records)}>
        {zh.common.backToRecords}
      </Button>
    </div>
  )
}
