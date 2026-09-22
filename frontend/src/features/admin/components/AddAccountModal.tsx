import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { App as AntdApp, Form, Input, Modal, Select } from 'antd'
import { presentError } from '@/api/presentError'
import type { AdminAccount } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { createAccount } from '../api/accounts'
import ActivationCodeModal, { type OneTimeSecret } from './ActivationCodeModal'

/**
 * 添加后台账号（§5「管理管理员账号」）。
 *
 * 表单里**没有密码字段**：初始密码由服务端生成、只显示一次。让超管自己
 * 设一个等于双方共享同一个口令，而且几乎必然留在聊天记录里。
 *
 * 创建成功后立刻把密码推上来 —— 与 AddParticipantModal 同理，
 * 「添加成功」如果只弹一下就没了，管理员手上就没有凭证了。
 */
export interface AddAccountModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

interface FormValues {
  student_id: string
  name: string
  role: AdminAccount['role']
}

export default function AddAccountModal({ open, onClose, onCreated }: AddAccountModalProps) {
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [created, setCreated] = useState<AdminAccount | null>(null)
  const [secret, setSecret] = useState<OneTimeSecret[]>([])
  const [secretOpen, setSecretOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: createAccount,
    onSuccess: (result) => {
      setCreated(result.account)
      setSecret([
        {
          studentId: result.account.student_id,
          name: result.account.name,
          secret: result.password,
        },
      ])
      setSecretOpen(true)
      form.resetFields()
      onCreated()
    },
    onError: (error) => {
      // 学号冲突是最常见的失败，字段级错误落到输入框上比 toast 一闪而过清楚得多
      const presented = presentError(error)
      const fields = presented.fields.map((field) => ({
        name: field.field as keyof FormValues,
        errors: [field.message],
      }))
      if (fields.length > 0) form.setFields(fields)
      else message.error(presented.text)
    },
  })

  const close = () => {
    form.resetFields()
    setCreated(null)
    setSecret([])
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title={zh.admin.accounts.add}
        onCancel={close}
        onOk={() => form.submit()}
        okText={zh.admin.common.confirm}
        cancelText={zh.admin.common.cancel}
        confirmLoading={mutation.isPending}
        maskClosable={false}
        destroyOnHidden
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ role: 'reviewer' }}
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item
            name="student_id"
            label={zh.admin.accounts.studentId}
            rules={[{ required: true, message: zh.admin.accounts.studentId }]}
          >
            <Input autoFocus maxLength={64} />
          </Form.Item>
          <Form.Item
            name="name"
            label={zh.admin.accounts.name}
            rules={[{ required: true, message: zh.admin.accounts.name }]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="role"
            label={zh.admin.accounts.role}
            rules={[{ required: true, message: zh.admin.accounts.role }]}
          >
            <Select
              options={[
                { value: 'reviewer', label: zh.admin.accounts.roleLabel.reviewer },
                { value: 'super_admin', label: zh.admin.accounts.roleLabel.super_admin },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <ActivationCodeModal
        open={secretOpen}
        title={zh.admin.accounts.passwordTitle}
        warning={zh.admin.accounts.passwordWarning}
        secrets={secret}
        fileName={`password-${created?.student_id ?? 'account'}.csv`}
        onClose={() => setSecretOpen(false)}
      />
    </>
  )
}
