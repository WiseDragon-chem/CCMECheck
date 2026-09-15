import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { presentError } from '@/api/presentError'
import AuthLayout from '@/layouts/AuthLayout'
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
    <AuthLayout title="激活账号" subtitle="使用管理员发放的学号与激活码完成首次激活">
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item name="student_id" label="学号" rules={[{ required: true, message: '请填写学号' }]}>
          <Input placeholder="请输入学号" inputMode="numeric" autoComplete="username" />
        </Form.Item>

        <Form.Item
          name="activation_code"
          label="激活码"
          rules={[{ required: true, message: '请填写激活码' }]}
        >
          <Input placeholder="请输入激活码" autoComplete="one-time-code" />
        </Form.Item>

        <Form.Item
          name="password"
          label="设置密码"
          rules={[
            { required: true, message: '请设置密码' },
            { min: PASSWORD_MIN, message: `密码至少 ${PASSWORD_MIN} 位` },
            { max: PASSWORD_MAX, message: `密码不能超过 ${PASSWORD_MAX} 位` },
            { pattern: /[A-Za-z]/, message: '密码需要包含字母' },
            { pattern: /\d/, message: '密码需要包含数字' },
          ]}
        >
          <Input.Password placeholder="至少 8 位，含字母与数字" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirm"
          label="确认密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator: (_rule, value) =>
                !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致')),
            }),
          ]}
        >
          <Input.Password placeholder="再次输入密码" autoComplete="new-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          激活并登录
        </Button>
      </Form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Typography.Text type="secondary">已经激活过？</Typography.Text>{' '}
        <Link to={paths.login}>去登录</Link>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        激活后学号与姓名不能自行修改，如需更正请联系管理员。
      </Typography.Paragraph>
    </AuthLayout>
  )
}
