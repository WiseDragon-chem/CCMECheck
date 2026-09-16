import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Alert, Button, Form, Input, Typography, App as AntdApp } from 'antd'
import { presentError } from '@/api/presentError'
import AuthLayout from '@/layouts/AuthLayout'
import { zh } from '@/locales/zh-CN'
import { landingFor } from '@/routes/roles'
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
  const t = zh.auth

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 从被拦截的页面跳过来时回到原处；否则按角色落地 ——
  // 审核员与超管落到后台，参赛者落到主页面
  const from = (location.state as { from?: string } | null)?.from

  const onFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    try {
      const user = await login(values.student_id.trim(), values.password)
      navigate(from ?? landingFor(user.role), { replace: true })
    } catch (caught) {
      const presented = presentError(caught)

      // 账号未激活不是错误，是「你还没走激活流程」——给个去激活的入口更实用
      if (presented.code === 'ACCOUNT_NOT_ACTIVATED') {
        message.info(t.login.notActivatedNotice)
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
    <AuthLayout title={t.login.title} subtitle={t.login.subtitle}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item
          name="student_id"
          label={t.login.studentId}
          rules={[{ required: true, message: t.login.studentIdRequired }]}
        >
          <Input placeholder={t.login.studentIdPlaceholder} autoComplete="username" inputMode="numeric" />
        </Form.Item>

        <Form.Item name="password" label={t.login.password} rules={[{ required: true, message: t.login.passwordRequired }]}>
          <Input.Password placeholder={t.login.passwordPlaceholder} autoComplete="current-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          {t.login.submit}
        </Button>
      </Form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Typography.Text type="secondary">{t.login.notActivatedYet}</Typography.Text>{' '}
        <Link to={paths.activate}>{t.login.goActivate}</Link>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        {t.login.forgotPassword}
      </Typography.Paragraph>
    </AuthLayout>
  )
}
