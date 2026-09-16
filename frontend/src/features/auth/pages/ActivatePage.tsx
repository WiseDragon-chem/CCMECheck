import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { presentError } from '@/api/presentError'
import AuthLayout from '@/layouts/AuthLayout'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import { useAuthStore } from '@/stores/auth.store'

interface FormValues {
  student_id: string
  activation_code: string
  password: string
  confirm: string
}

/**
 * 账号激活（design.md §7.1）。
 *
 * 密码规则与后端 auth/schema.ts 保持一致 —— 前端先拦一遍只是省一次往返，
 * 服务端才是权威；不一致时用户会看到后端返回的字段级错误。
 */
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

export default function ActivatePage() {
  const activate = useAuthStore((state) => state.activate)
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = zh.auth.activate

  const onFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    try {
      await activate(values.student_id.trim(), values.activation_code.trim(), values.password)
      navigate(paths.home, { replace: true })
    } catch (caught) {
      setError(presentError(caught).text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item name="student_id" label={t.studentId} rules={[{ required: true, message: t.studentIdRequired }]}>
          <Input placeholder={t.studentIdPlaceholder} inputMode="numeric" autoComplete="username" />
        </Form.Item>

        <Form.Item
          name="activation_code"
          label={t.activationCode}
          rules={[{ required: true, message: t.activationCodeRequired }]}
        >
          <Input placeholder={t.activationCodePlaceholder} autoComplete="one-time-code" />
        </Form.Item>

        <Form.Item
          name="password"
          label={t.password}
          rules={[
            { required: true, message: t.passwordRequired },
            { min: PASSWORD_MIN, message: t.passwordMin(PASSWORD_MIN) },
            { max: PASSWORD_MAX, message: t.passwordMax(PASSWORD_MAX) },
            { pattern: /[A-Za-z]/, message: t.passwordNeedsLetter },
            { pattern: /\d/, message: t.passwordNeedsDigit },
          ]}
        >
          <Input.Password placeholder={t.passwordPlaceholder} autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirm"
          label={t.confirm}
          dependencies={['password']}
          rules={[
            { required: true, message: t.confirmRequired },
            ({ getFieldValue }) => ({
              validator: (_rule, value) =>
                !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(t.confirmMismatch)),
            }),
          ]}
        >
          <Input.Password placeholder={t.confirmPlaceholder} autoComplete="new-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          {t.submit}
        </Button>
      </Form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Typography.Text type="secondary">{t.alreadyActivated}</Typography.Text>{' '}
        <Link to={paths.login}>{t.goLogin}</Link>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        {t.nameLockNotice}
      </Typography.Paragraph>
    </AuthLayout>
  )
}
