import { Card, Typography } from 'antd'

/**
 * 占位页：记录详情。
 *
 * 查看证明材料、审核结果与历史提交版本。
 * 在后续阶段实现 —— 这里刻意不渲染假数据，免得看起来像做好了。
 */
export default function RecordDetailPage() {
  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        记录详情
      </Typography.Title>
      <Card>
        <Typography.Text type="secondary">该页面尚未实现。</Typography.Text>
      </Card>
    </div>
  )
}
