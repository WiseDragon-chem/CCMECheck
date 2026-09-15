import { Card, Typography } from 'antd'

/**
 * 占位页：打卡记录。
 *
 * 按日期倒序查看每日打卡、审核结果与驳回原因。
 * 在后续阶段实现 —— 这里刻意不渲染假数据，免得看起来像做好了。
 */
export default function RecordsPage() {
  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        打卡记录
      </Typography.Title>
      <Card>
        <Typography.Text type="secondary">该页面尚未实现。</Typography.Text>
      </Card>
    </div>
  )
}
