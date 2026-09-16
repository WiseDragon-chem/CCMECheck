import { useState } from 'react'
import { Alert, App as AntdApp, Button, Input, Modal, Space, Table, Typography } from 'antd'
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { toCsvText } from '@/lib/csv'
import { saveTextAsFile } from '@/lib/download'
import { zh } from '@/locales/zh-CN'

/**
 * 一次性明文的展示（§8.3、§13）。
 *
 * 这个对话框承载的是整个名单模块里**唯一不可重来**的一步：激活码与
 * 临时密码在服务端只存哈希，关掉就再也查不到了。所以有三条纪律：
 *
 *   1. 不用 message 弹一下就消失 —— 那个提示 3 秒后自动关，而管理员
 *      可能正在切窗口去复制学号。
 *   2. 必须能一次带走。上百个码靠手抄是不现实的，所以给了复制与
 *      下载 CSV 两条路（CSV 由前端从这次的响应生成，服务端不提供
 *      明文导出 —— 库里本来就没有明文可导）。
 *   3. 警告写在标题下方而不是角落里，并且说清补救办法（重新生成，
 *      旧码会作废），否则管理员只会慌张。
 */
export interface OneTimeSecret {
  studentId: string
  name: string
  secret: string
}

export interface ActivationCodeModalProps {
  open: boolean
  /** 单条时用「激活码」之类的标题；导入后可能一次几十条 */
  title: string
  warning: string
  /** 只给一个人发时，标出是谁的码 */
  secrets: OneTimeSecret[]
  /** CSV 的文件名 */
  fileName: string
  onClose: () => void
}

export default function ActivationCodeModal({
  open,
  title,
  warning,
  secrets,
  fileName,
  onClose,
}: ActivationCodeModalProps) {
  const { message } = AntdApp.useApp()
  const [copied, setCopied] = useState(false)

  const copy = (text: string, done: () => void) => {
    void navigator.clipboard
      .writeText(text)
      .then(done)
      // 剪贴板 API 在非 HTTPS 或没有用户手势时会拒绝。走到这里时
      // 输入框仍然可以手动选中复制，所以只提示不打断
      .catch(() => message.warning(zh.admin.participants.codeCopy))
  }

  const download = () => {
    const csv = toCsvText(
      [zh.admin.participants.codeColumnStudentId, zh.admin.participants.codeColumnName, zh.admin.participants.codeColumnCode],
      secrets.map((item) => [item.studentId, item.name, item.secret]),
    )
    saveTextAsFile(csv, fileName)
  }

  // 单条时不画表格：一个只有一行的表格比一行文字更难读
  const single = secrets.length === 1 ? secrets[0] : null

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={onClose}
      okText={zh.admin.participants.close}
      cancelButtonProps={{ style: { display: 'none' } }}
      // 点遮罩关闭会让管理员在找快捷键时误关，而这一步不可重来
      maskClosable={false}
      width={secrets.length > 1 ? 640 : 480}
      /*
        关闭按钮**任何情况下都要有**。早先的写法是「单条码时只给一个复制按钮」，
        而遮罩又设了不可点击关闭 —— 结果管理员复制完就出不去了，
        只能靠 Esc。一个没有关闭出口的对话框是不能接受的。
      */
      footer={
        <Space>
          {secrets.length > 1 && (
            <Button icon={<DownloadOutlined />} onClick={download}>
              {zh.admin.participants.codeDownload}
            </Button>
          )}
          {single && (
            <Button
              icon={<CopyOutlined />}
              onClick={() =>
                copy(single.secret, () => {
                  setCopied(true)
                  message.success(zh.admin.participants.codeCopied)
                })
              }
            >
              {copied ? zh.admin.participants.codeCopied : zh.admin.participants.codeCopy}
            </Button>
          )}
          <Button type="primary" onClick={onClose}>
            {zh.admin.participants.close}
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={warning}
      />

      {single && (
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <Typography.Text strong>
            {zh.admin.participants.codeFor(single.name, single.studentId)}
          </Typography.Text>
        </Typography.Paragraph>
      )}

      {single ? (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Input
            readOnly
            value={single.secret}
            addonAfter={
              <CopyOutlined
                onClick={() => copy(single.secret, () => setCopied(true))}
                style={{ cursor: 'pointer' }}
              />
            }
            style={{ fontFamily: 'monospace' }}
          />
        </Space>
      ) : (
        <Table<OneTimeSecret>
          size="small"
          rowKey={(row) => `${row.studentId}-${row.secret}`}
          dataSource={secrets}
          pagination={secrets.length > 20 ? { pageSize: 20 } : false}
          columns={[
            { title: zh.admin.participants.codeColumnStudentId, dataIndex: 'studentId', width: 130 },
            { title: zh.admin.participants.codeColumnName, dataIndex: 'name', width: 110 },
            {
              title: zh.admin.participants.codeColumnCode,
              dataIndex: 'secret',
              render: (value: string) => (
                <Typography.Text style={{ fontFamily: 'monospace' }} copyable>
                  {value}
                </Typography.Text>
              ),
            },
          ]}
        />
      )}
    </Modal>
  )
}
