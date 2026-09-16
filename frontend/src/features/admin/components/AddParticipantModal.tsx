import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { App as AntdApp, Form, Input, Modal } from 'antd'
import { presentError } from '@/api/presentError'
import type { AdminParticipant } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { createParticipant } from '../api/participants'
import ActivationCodeModal, { type OneTimeSecret } from './ActivationCodeModal'

/**
 * 添加单个参赛者（§8.3）。
 *
 * 补一个漏在名单外的人，比让他重走一次完整导入要现实得多。
 *
 * 创建成功后**立刻**把激活码推上来：它只出现这一次，而「添加成功」
 * 这个提示如果只是弹一下就消失，管理员很快就会发现自己手上没有码，
 * 只能重新生成（那会让刚发的码作废）。
 */
export interface AddParticipantModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

interface FormValues {
  student_id: string
  name: string
  class_name?: string
  phone_suffix?: string
  remark?: string
}

export default function AddParticipantModal({ open, onClose, onCreated }: AddParticipantModalProps) {
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [created, setCreated] = useState<AdminParticipant | null>(null)
  const [code, setCode] = useState<OneTimeSecret[]>([])
  const [codeOpen, setCodeOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: createParticipant,
    onSuccess: (result) => {
      setCreated(result.participant)
      setCode([
        {
          studentId: result.participant.student_id,
          name: result.participant.name,
          secret: result.activation_code,
        },
      ])
      setCodeOpen(true)
      form.resetFields()
      onCreated()
    },
    onError: (error) => {
      // 字段级错误优先落到对应输入框上：学号重复是最常见的一种，
      // 而这个信息在 toast 里一闪而过很难看清
      const presented = presentError(error)
      const fields = presented.fields.map((field) => ({
        // 服务端的字段名就是请求体的 snake_case 字段名，与 Form.Item 的 name 一致
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
    setCode([])
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title={zh.admin.participants.add}
        onCancel={close}
        onOk={() => form.submit()}
        okText={zh.admin.common.confirm}
        cancelText={zh.admin.common.cancel}
        confirmLoading={mutation.isPending}
        maskClosable={false}
        destroyOnHidden
      >
        <Form<FormValues> form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item
            name="student_id"
            label={zh.admin.participants.studentId}
            rules={[{ required: true, message: zh.admin.participants.studentId }]}
          >
            <Input autoFocus maxLength={64} />
          </Form.Item>
          <Form.Item
            name="name"
            label={zh.admin.participants.name}
            rules={[{ required: true, message: zh.admin.participants.name }]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="class_name" label={zh.admin.participants.className}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="phone_suffix" label={zh.admin.participants.phoneSuffix}>
            <Input maxLength={16} />
          </Form.Item>
          <Form.Item name="remark" label={zh.admin.participants.remark}>
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <ActivationCodeModal
        open={codeOpen}
        title={zh.admin.participants.codeTitle}
        warning={zh.admin.participants.codeWarning}
        secrets={code}
        fileName={`activation-${created?.student_id ?? 'code'}.csv`}
        onClose={() => setCodeOpen(false)}
      />
    </>
  )
}
