import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Alert, Button, Form, Input, Typography, App as AntdApp } from 'antd'
import { presentError } from '@/api/presentError'
import AuthLayout from '@/layouts/AuthLayout'
import { paths } from '@/routes/paths'
import { useAuthStore } from '@/stores/auth.store'

interface FormValues {
  student_id: string
  password: string
}

export default function LoginPage() {
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = AntdApp.useApp()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 从被拦截的页面跳过来时回到原处
  const from = (location.state as { from?: string } | null)?.from ?? paths.home

  const onFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    try {
      await login(values.student_id.trim(), values.password)
      navigate(from, { replace: true })
    } catch (caught) {
      const presented = presentError(caught)

      // 账号未激活不是错误，是「你还没走激活流程」——给个去激活的入口更实用
      if (presented.code === 'ACCOUNT_NOT_ACTIVATED') {
        message.info('该账号尚未激活，请先使用激活码完成激活')
        navigate(paths.activate)
        return
      }

      // 限流时不透露剩余时间（服务端也没给），只提示稍后再试
      setError(presented.text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="登录" subtitle="使用学号与密码登录">
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item
          name="student_id"
          label="学号"
          rules={[{ required: true, message: '请填写学号' }]}
        >
          <Input placeholder="请输入学号" autoComplete="username" inputMode="numeric" />
        </Form.Item>

        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请填写密码' }]}>
          <Input.Password placeholder="请输入密码" autoComplete="current-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          登录
        </Button>
      </Form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Typography.Text type="secondary">还没有激活？</Typography.Text>{' '}
        <Link to={paths.activate}>去激活</Link>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        忘记密码请联系活动管理员重置。
      </Typography.Paragraph>
    </AuthLayout>
  )
}
