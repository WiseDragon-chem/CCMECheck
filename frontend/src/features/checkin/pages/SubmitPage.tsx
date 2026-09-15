import { Card, Typography } from 'antd'

/**
 * 占位页：提交打卡。
 *
 * 上传证明材料并提交。
 * 在后续阶段实现 —— 这里刻意不渲染假数据，免得看起来像做好了。
 */
export default function SubmitPage() {
  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        提交打卡
      </Typography.Title>
      <Card>
        <Typography.Text type="secondary">该页面尚未实现。</Typography.Text>
      </Card>
    </div>
  )
}
