import { useNavigate, useRouteError } from 'react-router'
import { Button, Result, Typography } from 'antd'
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
        title="页面出错了"
        subTitle="请刷新重试。若持续出现，请把下面的信息发给活动管理员。"
        extra={[
          <Button type="primary" key="home" onClick={() => navigate(paths.home)}>
            回到首页
          </Button>,
          <Button key="reload" onClick={() => window.location.reload()}>
            刷新页面
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
