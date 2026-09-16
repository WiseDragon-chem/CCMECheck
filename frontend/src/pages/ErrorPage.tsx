import { useNavigate, useRouteError } from 'react-router'
import { Button, Result, Typography } from 'antd'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'

/**
 * 路由级错误边界。
 *
 * 没有它，一次渲染异常会留下整片白屏 —— 对参赛者来说，
 * 白屏和「打卡失败了」是同一种体验，且完全无从反馈。
 */
export default function ErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()

  const detail = error instanceof Error ? error.message : String(error ?? '')

  return (
    <div className="centered-page">
      <Result
        status="error"
        title={zh.error.pageTitle}
        subTitle={zh.error.pageSubtitle}
        extra={[
          <Button type="primary" key="home" onClick={() => navigate(paths.home)}>
            {zh.common.backHome}
          </Button>,
          <Button key="reload" onClick={() => window.location.reload()}>
            {zh.error.reload}
          </Button>,
        ]}
      >
        {import.meta.env.DEV && detail && (
          <Typography.Paragraph>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{detail}</pre>
          </Typography.Paragraph>
        )}
      </Result>
    </div>
  )
}
