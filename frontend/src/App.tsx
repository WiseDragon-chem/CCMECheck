import { useEffect, useState } from 'react'
import { Alert, Card, Space, Tag, Typography } from 'antd'
import { API_BASE_URL } from './config/env'

/**
 * 临时占位页。
 *
 * 它的唯一职责是验证脚手架：Vite 能起、antd 主题生效、
 * **以及 /api 代理确实打到了后端**（这是本阶段最需要确认的一件事）。
 *
 * 路由与真正的页面在后续阶段接入，届时整个文件会被替换掉。
 */
interface ProbeResult {
  ok: boolean
  status?: number
  code?: string
  requestId?: string
  error?: string
}

export default function App() {
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  useEffect(() => {
    // 未带令牌请求受保护接口，预期得到 401 与统一错误信封 ——
    // 能拿到信封就说明代理链路是通的
    fetch(`${API_BASE_URL}/campaigns/current`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { code?: string; request_id?: string }
          | null
        setProbe({
          ok: true,
          status: response.status,
          code: body?.code,
          requestId: body?.request_id,
        })
      })
      .catch((error: unknown) => {
        setProbe({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
  }, [])

  return (
    <div className="participant-shell" style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          国庆打卡
        </Typography.Title>

        <Card title="脚手架自检" size="small">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Tag color="green">Vite + React 已启动</Tag>
              <Tag color="green">antd 主题已加载</Tag>
            </div>
            <Typography.Text type="secondary">
              接口前缀：<code>{API_BASE_URL}</code>
            </Typography.Text>

            {probe === null && <Alert type="info" message="正在探测后端…" showIcon />}

            {probe?.ok && (
              <Alert
                type="success"
                showIcon
                message="后端可达（/api 代理正常）"
                description={
                  <span>
                    状态码 <code>{probe.status}</code>
                    {probe.code && (
                      <>
                        ，错误码 <code>{probe.code}</code>
                      </>
                    )}
                    {probe.requestId && (
                      <>
                        ，request_id <code>{probe.requestId}</code>
                      </>
                    )}
                    <br />
                    <Typography.Text type="secondary">
                      未登录访问受保护接口返回 401 与统一错误信封，这正是预期结果。
                    </Typography.Text>
                  </span>
                }
              />
            )}

            {probe && !probe.ok && (
              <Alert
                type="error"
                showIcon
                message="探测失败 —— 代理没打通"
                description={
                  <span>
                    {probe.error}
                    <br />
                    <Typography.Text type="secondary">
                      确认后端已在 3000 端口运行（server/ 下执行 npm run dev）。
                    </Typography.Text>
                  </span>
                }
              />
            )}
          </Space>
        </Card>
      </Space>
    </div>
  )
}
