import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { presentError } from '@/api/presentError'
import GuideTour from '@/features/guide/GuideTour'
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

      // 登录接口不会回 ACCOUNT_NOT_ACTIVATED：未激活的账号与「学号不存在」
      // 在服务端是同一条错误，否则就成了免认证的名单探针（见 auth/service.ts）。
      // 未激活的用户由下方常驻的「尚未激活？去激活」入口引导。
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

      <div style={{ marginTop: 16, textAlign: 'center' }} data-tour="login-activate">
        <Typography.Text type="secondary">{t.login.notActivatedYet}</Typography.Text>{' '}
        <Link to={paths.activate}>{t.login.goActivate}</Link>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        {t.login.forgotPassword}
      </Typography.Paragraph>

      {/*
        ready 恒为 true：守卫在已登录时直接渲染 <Navigate> 而不挂载本页，
        booting 时返回 null 也不挂载，所以这里不会和跳转抢时间。
      */}
      <GuideTour
        id="login"
        ready
        steps={[
          {
            target: 'login-activate',
            title: zh.tour.login.title,
            step: zh.tour.login.step,
            body: zh.tour.login.body,
          },
        ]}
      />
    </AuthLayout>
  )
}
