import { Card, Typography } from 'antd'

/**
 * 占位页：排行榜。
 *
 * 读书榜、单词榜、健身榜与总榜。
 * 在后续阶段实现 —— 这里刻意不渲染假数据，免得看起来像做好了。
 */
export default function LeaderboardPage() {
  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        排行榜
      </Typography.Title>
      <Card>
        <Typography.Text type="secondary">该页面尚未实现。</Typography.Text>
      </Card>
    </div>
  )
}
