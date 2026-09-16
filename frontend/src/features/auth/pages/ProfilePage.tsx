import { useState } from 'react'
import { useNavigate } from 'react-router'
import { App as AntdApp, Button, Card, Descriptions, Divider, Form, Input, Typography } from 'antd'
import { changePassword } from '@/api/endpoints/auth'
import { presentError } from '@/api/presentError'
import { setAccessToken } from '@/api/tokenStore'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import { useAuthStore } from '@/stores/auth.store'

interface FormValues {
  current_password: string
  new_password: string
  confirm: string
}

const PASSWORD_MIN = 8

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const { message, modal } = AntdApp.useApp()
  const t = zh.auth.profile

  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)

  const onChangePassword = async (values: FormValues) => {
    setSubmitting(true)
    try {
      const response = await changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      })
      // 改密会撤销其它设备上的全部会话，并为当前设备补发一套新凭证 ——
      // 不存下来的话，用户会在下一次请求时被登出
      setAccessToken(response.access_token, response.expires_in)
      form.resetFields()
      message.success(t.passwordChanged)
    } catch (caught) {
      const presented = presentError(caught)
      if (presented.fields.length > 0) {
        form.setFields(
          presented.fields.map((f) => ({ name: f.field as keyof FormValues, errors: [f.message] })),
        )
      } else {
        message.error(presented.text)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onLogout = () => {
    modal.confirm({
      title: t.logoutConfirmTitle,
      okText: t.logoutOk,
      cancelText: t.logoutCancel,
      onOk: async () => {
        await logout()
        navigate(paths.login, { replace: true })
      },
    })
  }

  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t.title}
      </Typography.Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={t.name}>{user?.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={t.studentId}>{user?.student_id ?? '—'}</Descriptions.Item>
        </Descriptions>
        {/* §7.1：首次激活后学号与姓名不能自行修改 */}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t.nameLockNotice}
        </Typography.Text>
      </Card>

      <Card title={t.changePassword} size="small">
        <Form<FormValues> form={form} layout="vertical" onFinish={onChangePassword} requiredMark={false}>
          <Form.Item
            name="current_password"
            label={t.currentPassword}
            rules={[{ required: true, message: t.currentPasswordRequired }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label={t.newPassword}
            rules={[
              { required: true, message: t.newPasswordRequired },
              { min: PASSWORD_MIN, message: t.newPasswordMin(PASSWORD_MIN) },
              { pattern: /[A-Za-z]/, message: t.newPasswordNeedsLetter },
              { pattern: /\d/, message: t.newPasswordNeedsDigit },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder={t.newPasswordPlaceholder} />
          </Form.Item>

          <Form.Item
            name="confirm"
            label={t.confirmNewPassword}
            dependencies={['new_password']}
            rules={[
              { required: true, message: t.confirmRequired },
              ({ getFieldValue }) => ({
                validator: (_rule, value) =>
                  !value || getFieldValue('new_password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error(t.confirmMismatch)),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t.savePassword}
          </Button>
        </Form>
      </Card>

      <Divider />

      <Button danger block onClick={onLogout} style={{ marginBottom: 24 }}>
        {t.logout}
      </Button>
    </div>
  )
}
