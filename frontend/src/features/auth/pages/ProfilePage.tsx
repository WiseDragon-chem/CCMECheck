import { useState } from 'react'
import { useNavigate } from 'react-router'
import { App as AntdApp, Button, Card, Descriptions, Divider, Form, Input, Typography } from 'antd'
import { changePassword } from '@/api/endpoints/auth'
import { presentError } from '@/api/presentError'
import { setAccessToken } from '@/api/tokenStore'
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
      message.success('密码已修改，其他设备需要重新登录')
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
      title: '确认退出登录？',
      okText: '退出',
      cancelText: '取消',
      onOk: async () => {
        await logout()
        navigate(paths.login, { replace: true })
      },
    })
  }

  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        我的
      </Typography.Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label="姓名">{user?.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="学号">{user?.student_id ?? '—'}</Descriptions.Item>
        </Descriptions>
        {/* §7.1：首次激活后学号与姓名不能自行修改 */}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          学号与姓名如需更正，请联系活动管理员。
        </Typography.Text>
      </Card>

      <Card title="修改密码" size="small">
        <Form<FormValues> form={form} layout="vertical" onFinish={onChangePassword} requiredMark={false}>
          <Form.Item
            name="current_password"
            label="当前密码"
            rules={[{ required: true, message: '请填写当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请设置新密码' },
              { min: PASSWORD_MIN, message: `新密码至少 ${PASSWORD_MIN} 位` },
              { pattern: /[A-Za-z]/, message: '新密码需要包含字母' },
              { pattern: /\d/, message: '新密码需要包含数字' },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="至少 8 位，含字母与数字" />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value) =>
                  !value || getFieldValue('new_password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={submitting}>
            保存新密码
          </Button>
        </Form>
      </Card>

      <Divider />

      <Button danger block onClick={onLogout} style={{ marginBottom: 24 }}>
        退出登录
      </Button>
    </div>
  )
}
