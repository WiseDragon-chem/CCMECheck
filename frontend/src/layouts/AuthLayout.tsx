import type { ReactNode } from 'react'
import { Card, Typography } from 'antd'

/**
 * 登录与激活页的共用外壳。
 *
 * 用静态标题而不是活动名：这两个页面在登录之前，
 * 此时 /campaigns/current 还是 401，拿不到活动名。
 */
export default function AuthLayout({ title, subtitle, children }: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="centered-page">
      <div className="centered-page__card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            国庆打卡
          </Typography.Title>
          <Typography.Text type="secondary">化学与分子工程学院</Typography.Text>
        </div>

        <Card>
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: subtitle ? 4 : 20 }}>
            {title}
          </Typography.Title>
          {subtitle && (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
              {subtitle}
            </Typography.Paragraph>
          )}
          {children}
        </Card>
      </div>
    </div>
  )
}
