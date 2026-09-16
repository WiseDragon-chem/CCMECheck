import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { InboxOutlined } from '@ant-design/icons'
import { Alert, App as AntdApp, Button, Modal, Space, Steps, Table, Tag, Typography, Upload } from 'antd'
import { presentError } from '@/api/presentError'
import type { ImportPreviewResponse, ImportPreviewRow } from '@/api/types'
import { formatCst } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { commitImport, downloadTemplate, previewImport } from '../api/participants'
import ActivationCodeModal, { type OneTimeSecret } from './ActivationCodeModal'

/**
 * 名单导入（§8.3、§7.1）。
 *
 * 三步：选文件 → 预览 → 确认。中间那一步是这个流程存在的理由 ——
 * 一份几百行的名单里出几个错行是常态（学号重复、班级写错、行尾多个逗号），
 * 而**预览与正式导入用的是同一次计算的结论**：管理员看到什么就导入什么，
 * 不存在「预览说没问题、导入却报错」这种事。
 *
 * 提交时只回传 batch_id，不把预览结果发回去：服务端会重新读取暂存文件
 * 重新解析。客户端传来的行数据一律不参与写入 —— 否则预览与写入之间
 * 就存在一个可以篡改的窗口。
 */
export interface ImportParticipantsModalProps {
  open: boolean
  onClose: () => void
  /** 导入成功后刷新名单 */
  onImported: () => void
}

type Step = 'select' | 'preview' | 'done'

export default function ImportParticipantsModal({
  open,
  onClose,
  onImported,
}: ImportParticipantsModalProps) {
  const { message } = AntdApp.useApp()
  const [step, setStep] = useState<Step>('select')
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [codes, setCodes] = useState<OneTimeSecret[]>([])
  const [codesOpen, setCodesOpen] = useState(false)

  const previewMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => {
      setPreview(result)
      setStep('preview')
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const commitMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: (result) => {
      message.success(zh.admin.participants.importDone(result.created, result.updated, result.skipped))
      setCodes(
        result.activation_codes.map((item) => ({
          studentId: item.student_id,
          name: item.name,
          secret: item.activation_code,
        })),
      )
      setStep('done')
      onImported()
      // 有新建账号就把明文码立刻推上来：它是这一次导入最需要被带走的东西，
      // 藏在「完成」按钮后面等于默认管理员会自己想起来
      if (result.activation_codes.length > 0) setCodesOpen(true)
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const reset = () => {
    setStep('select')
    setPreview(null)
    setCodes([])
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title={zh.admin.participants.importTitle}
        onCancel={close}
        maskClosable={false}
        width={760}
        footer={
          <Space>
            {step === 'preview' && (
              <Button onClick={reset}>{zh.admin.participants.importBack}</Button>
            )}
            {step === 'select' && <Button onClick={close}>{zh.admin.common.cancel}</Button>}
            {step === 'preview' && (
              <Button
                type="primary"
                loading={commitMutation.isPending}
                onClick={() => preview && commitMutation.mutate({ batch_id: preview.batch_id })}
              >
                {zh.admin.participants.importCommit}
              </Button>
            )}
            {step === 'done' && (
              <Button type="primary" onClick={close}>
                {zh.admin.participants.importClose}
              </Button>
            )}
          </Space>
        }
      >
        <Steps
          size="small"
          current={step === 'select' ? 0 : step === 'preview' ? 1 : 2}
          items={[
            { title: zh.admin.participants.importStepSelect },
            { title: zh.admin.participants.importStepPreview },
            { title: zh.admin.participants.importStepResult },
          ]}
          style={{ marginBottom: 16 }}
        />

        {step === 'select' && (
          <>
            <Upload.Dragger
              accept=".csv,text/csv"
              maxCount={1}
              // 自己接管上传：antd 的默认行为会立刻 POST 到 action，
              // 而这里要先预览、由管理员确认之后才提交。
              // 返回 false 即阻止自动上传（RcFile 是 File 的子类，可以直接用）
              beforeUpload={(uploadFile) => {
                previewMutation.mutate(uploadFile)
                return false
              }}
              showUploadList={false}
              disabled={previewMutation.isPending}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{zh.admin.participants.importDropHint}</p>
            </Upload.Dragger>

            <Space direction="vertical" size={4} style={{ marginTop: 12, width: '100%' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {zh.admin.participants.templateHint}
              </Typography.Text>
              <Space size={8}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {zh.admin.participants.importReadTemplate}
                </Typography.Text>
                <Button
                  size="small"
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() =>
                    void downloadTemplate().catch((error) => message.error(presentError(error).text))
                  }
                >
                  {zh.admin.participants.downloadTemplate}
                </Button>
              </Space>
            </Space>

            {previewMutation.isPending && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message={zh.admin.participants.importPreviewing}
              />
            )}
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={zh.admin.participants.importSummary(
                preview.summary.total,
                preview.summary.valid,
                preview.summary.invalid,
              )}
              description={
                <Space direction="vertical" size={2}>
                  {preview.summary.existing_users > 0 && (
                    <span>{zh.admin.participants.importExisting(preview.summary.existing_users)}</span>
                  )}
                  {preview.summary.duplicates_in_file > 0 && (
                    <span>{zh.admin.participants.importDuplicates(preview.summary.duplicates_in_file)}</span>
                  )}
                  {preview.rows_truncated && (
                    <span>{zh.admin.participants.importRowsTruncated(preview.rows.length)}</span>
                  )}
                  <span>{zh.admin.participants.importCommitHint}</span>
                </Space>
              }
            />

            <Table<ImportPreviewRow>
              size="small"
              rowKey="line"
              dataSource={preview.rows}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              columns={[
                {
                  title: zh.admin.participants.studentId,
                  dataIndex: 'student_id',
                  width: 130,
                  // 行号是原始 CSV 里的行号，管理员据此回文件里定位
                  render: (value: string, row) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text style={{ fontSize: 12 }}>{value}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {zh.admin.participants.importLine(row.line)}
                      </Typography.Text>
                    </Space>
                  ),
                },
                { title: zh.admin.participants.name, dataIndex: 'name', width: 100 },
                { title: zh.admin.participants.className, dataIndex: 'class_name', width: 110 },
                {
                  title: zh.admin.participants.actions,
                  dataIndex: 'status',
                  render: (_value, row) =>
                    row.errors.length > 0 ? (
                      <Space direction="vertical" size={0}>
                        <Tag color="red" style={{ marginInlineEnd: 0 }}>
                          {zh.admin.participants.importRowError}
                        </Tag>
                        {row.errors.map((error) => (
                          <Typography.Text key={error} type="danger" style={{ fontSize: 12 }}>
                            {error}
                          </Typography.Text>
                        ))}
                      </Space>
                    ) : (
                      <Space size={4}>
                        <Tag color="green" style={{ marginInlineEnd: 0 }}>
                          {zh.admin.participants.importRowOk}
                        </Tag>
                        <Tag style={{ marginInlineEnd: 0 }}>
                          {row.existing
                            ? zh.admin.participants.importRowExisting
                            : zh.admin.participants.importRowNew}
                        </Tag>
                      </Space>
                    ),
                },
              ]}
            />
          </>
        )}

        {step === 'done' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="success"
              showIcon
              message={zh.admin.participants.importDone(
                commitMutation.data?.created ?? 0,
                commitMutation.data?.updated ?? 0,
                commitMutation.data?.skipped ?? 0,
              )}
            />
            {codes.length === 0 ? (
              <Typography.Text type="secondary">
                {zh.admin.participants.importNoCodes}
              </Typography.Text>
            ) : (
              <Button onClick={() => setCodesOpen(true)}>{zh.admin.participants.codeTitle}</Button>
            )}
          </Space>
        )}
      </Modal>

      <ActivationCodeModal
        open={codesOpen}
        title={zh.admin.participants.codeTitle}
        warning={zh.admin.participants.codeWarning}
        secrets={codes}
        // 用北京时间的日期，而不是 toISOString 的 UTC 日期 ——
        // 后者在晚上 8 点之后会写成第二天
        fileName={`activation-codes-${formatCst(new Date().toISOString(), 'YYYY-MM-DD')}.csv`}
        onClose={() => setCodesOpen(false)}
      />
    </>
  )
}
