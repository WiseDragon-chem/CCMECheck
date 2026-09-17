import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudUploadOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { presentError } from '@/api/presentError'
import { qk } from '@/api/queryKeys'
import type { AdminParticipant } from '@/api/types'
import LoadError from '@/components/LoadError'
import { formatCst } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import {
  anonymizeParticipant,
  downloadTemplate,
  exportActivationCodes,
  exportParticipants,
  fetchParticipantsList,
  regenerateActivationCode,
  resetParticipantPassword,
  updateParticipantStatus,
} from '../api/participants'
import ActivationCodeModal, { type OneTimeSecret } from '../components/ActivationCodeModal'
import AddParticipantModal from '../components/AddParticipantModal'
import ImportParticipantsModal from '../components/ImportParticipantsModal'
import ReasonModal from '../components/ReasonModal'

/**
 * 名单管理（design.md §8.3）。
 *
 * 这一页有三处不能省的设计，都是为了同一件事：**管理员手上的名单
 * 与系统里的名单必须对得上**。
 *
 *   1. 激活状态单独成列。`activated`（有没有设过密码）与 `account_status`
 *      （账号级状态）是两回事 —— 被禁用的账号仍然是「已激活」的。
 *      只看账号状态分不出「还没激活」和「激活后被禁用」，而这两件事的
 *      处置方式完全不同：前者重发激活码，后者解除禁用。
 *
 *   2. 表格按学号升序。管理员多半是拿着一份纸质或 Excel 名单在核对，
 *      按加入时间排序会让这个动作变成两遍扫描。
 *
 *   3. 会改变身份的操作都要确认，且把后果写清楚。重新生成激活码会作废
 *      旧码、禁用会踢掉会话、匿名化不可逆 —— 这三个都不该是一个顺手点的图标。
 */

const PAGE_SIZE = 20

interface Filters {
  keyword?: string
  status?: 'active' | 'disabled' | 'anonymized'
  class_name?: string
}

export default function ParticipantsPage() {
  const { message } = AntdApp.useApp()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>({})
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [secret, setSecret] = useState<{ title: string; warning: string; entries: OneTimeSecret[]; fileName: string } | null>(null)
  const [anonymizing, setAnonymizing] = useState<AdminParticipant | null>(null)
  const [anonymizeReason, setAnonymizeReason] = useState('')
  const [deleteEvidence, setDeleteEvidence] = useState(true)

  const query = useQuery({
    queryKey: qk.admin.participants({ ...filters, page }),
    queryFn: () => fetchParticipantsList({ ...filters, page, page_size: PAGE_SIZE }),
    // 名单是管理员自己改的，别人改动的概率低；切回来时重取一次就够
    staleTime: 30_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'participants'] })
    void queryClient.invalidateQueries({ queryKey: qk.admin.dashboard })
  }

  const statusMutation = useMutation({
    mutationFn: (params: { participant: AdminParticipant; status: 'active' | 'disabled' }) =>
      updateParticipantStatus(params.participant.id, { status: params.status }),
    onSuccess: (result, params) => {
      message.success(
        params.status === 'disabled'
          ? zh.admin.participants.disableDone
          : zh.admin.participants.enableDone,
      )
      // 禁用会撤销该账号的登录会话。这个数字值得说出来 ——
      // 管理员据此判断「他是不是正在填打卡」，从而决定要不要打个招呼
      if (result.revoked_sessions > 0) {
        message.info(zh.admin.participants.disableRevoked(result.revoked_sessions))
      }
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const regenerateMutation = useMutation({
    mutationFn: (participant: AdminParticipant) => regenerateActivationCode(participant.id),
    onSuccess: (result) => {
      setSecret({
        title: zh.admin.participants.codeTitle,
        warning: zh.admin.participants.codeWarning,
        entries: [
          {
            studentId: result.participant.student_id,
            name: result.participant.name,
            secret: result.activation_code,
          },
        ],
        fileName: `activation-${result.participant.student_id}.csv`,
      })
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const resetMutation = useMutation({
    mutationFn: (participant: AdminParticipant) => resetParticipantPassword(participant.id),
    onSuccess: (result) => {
      setSecret({
        title: zh.admin.participants.passwordTitle,
        warning: zh.admin.participants.passwordWarning,
        entries: [
          {
            studentId: result.participant.student_id,
            name: result.participant.name,
            secret: result.password,
          },
        ],
        fileName: `password-${result.participant.student_id}.csv`,
      })
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const anonymizeMutation = useMutation({
    mutationFn: (params: { participant: AdminParticipant; reason: string; deleteEvidence: boolean }) =>
      anonymizeParticipant(params.participant.id, {
        reason: params.reason,
        delete_evidence: params.deleteEvidence,
      }),
    onSuccess: (result) => {
      message.success(zh.admin.participants.anonymizeDone(result.deleted_assets))
      setAnonymizing(null)
      setAnonymizeReason('')
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const download = (task: () => Promise<void>) => {
    void task().catch((error) => message.error(presentError(error).text))
  }

  if (query.isError) {
    return (
      <LoadError
        error={query.error}
        title={zh.admin.common.loadFailed}
        extra={<Button onClick={() => void query.refetch()}>{zh.common.retry}</Button>}
      />
    )
  }

  const items = query.data?.items ?? []
  const hasFilters = Boolean(filters.keyword || filters.status || filters.class_name)

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {zh.admin.participants.title}
        </Typography.Title>
        <Typography.Text type="secondary">{zh.admin.participants.subtitle}</Typography.Text>
      </div>

      <Card size="small" styles={{ body: { paddingBottom: 12 } }}>
        <Space wrap size={8} style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            {zh.admin.participants.add}
          </Button>
          <Button icon={<CloudUploadOutlined />} onClick={() => setImportOpen(true)}>
            {zh.admin.participants.import}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => download(exportParticipants)}
          >
            {zh.admin.participants.exportRoster}
          </Button>
          {/*
            导出的是激活**状态**而不是码：库里只有哈希，明文永远导不出来。
            这一列回答的是「还有谁没激活」，那才是管理员要的东西。
          */}
          <Button icon={<DownloadOutlined />} onClick={() => download(exportActivationCodes)}>
            {zh.admin.participants.exportCodes}
          </Button>
          <Tooltip title={zh.admin.participants.templateHint}>
            <Button type="text" onClick={() => download(downloadTemplate)}>
              {zh.admin.participants.downloadTemplate}
            </Button>
          </Tooltip>
          <Button
            type="text"
            aria-label={zh.admin.common.refresh}
            icon={<ReloadOutlined />}
            onClick={() => void query.refetch()}
          />
        </Space>

        <Space wrap size={8}>
          <Input.Search
            allowClear
            style={{ width: 240 }}
            placeholder={zh.admin.participants.search}
            onSearch={(value) => {
              setPage(1)
              setFilters((current) => ({ ...current, keyword: value || undefined }))
            }}
          />
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder={zh.admin.participants.allStatus}
            value={filters.status}
            onChange={(status) => {
              setPage(1)
              setFilters((current) => ({ ...current, status }))
            }}
            options={[
              { value: 'active', label: zh.admin.participants.statusLabel.active },
              { value: 'disabled', label: zh.admin.participants.statusLabel.disabled },
              { value: 'anonymized', label: zh.admin.participants.statusLabel.anonymized },
            ]}
          />
          <Input
            allowClear
            style={{ width: 160 }}
            placeholder={zh.admin.participants.classNamePlaceholder}
            onChange={(event) => {
              const value = event.target.value || undefined
              setPage(1)
              setFilters((current) => ({ ...current, class_name: value }))
            }}
          />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<AdminParticipant>
          size="small"
          rowKey="id"
          loading={query.isFetching}
          dataSource={items}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: query.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (total) => zh.admin.common.total(total),
          }}
          locale={{
            emptyText: hasFilters
              ? zh.admin.participants.emptyFiltered
              : zh.admin.participants.empty,
          }}
          scroll={{ x: 1080 }}
          columns={[
            { title: zh.admin.participants.studentId, dataIndex: 'student_id', width: 130 },
            { title: zh.admin.participants.name, dataIndex: 'name', width: 110 },
            {
              title: zh.admin.participants.className,
              dataIndex: 'class_name',
              width: 120,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: zh.admin.participants.status,
              dataIndex: 'status',
              width: 100,
              render: (value: AdminParticipant['status']) => (
                <Tag
                  color={
                    value === 'active' ? 'green' : value === 'disabled' ? 'red' : 'default'
                  }
                >
                  {zh.admin.participants.statusLabel[value]}
                </Tag>
              ),
            },
            {
              title: zh.admin.participants.accountStatus,
              dataIndex: 'account_status',
              width: 100,
              render: (value: AdminParticipant['account_status']) =>
                zh.admin.participants.accountLabel[value],
            },
            {
              title: zh.admin.participants.activation,
              dataIndex: 'activated',
              width: 100,
              // 与上一列合起来才说得清「这个人现在能不能打卡」：
              // 已激活 + 已禁用 = 曾经用过，被管理员停了
              render: (value: boolean, row) =>
                row.status === 'anonymized' ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {zh.admin.participants.anonymizedHint}
                  </Typography.Text>
                ) : value ? (
                  <Tag color="blue">{zh.admin.participants.activated}</Tag>
                ) : (
                  <Tag>{zh.admin.participants.notActivated}</Tag>
                ),
            },
            {
              title: zh.admin.participants.phoneSuffix,
              dataIndex: 'phone_suffix',
              width: 100,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: zh.admin.participants.remark,
              dataIndex: 'remark',
              ellipsis: true,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: zh.admin.participants.joinedAt,
              dataIndex: 'joined_at',
              width: 120,
              render: (value: string) => formatCst(value, 'YYYY-MM-DD'),
            },
            {
              title: zh.admin.participants.actions,
              key: 'actions',
              width: 260,
              fixed: 'right',
              render: (_value, row) =>
                row.status === 'anonymized' ? (
                  // 匿名化之后身份已经抹除，任何针对「这个人」的操作都不再有意义
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {zh.admin.participants.anonymizedHint}
                  </Typography.Text>
                ) : (
                  <Space size={4} wrap>
                    <Popconfirm
                      title={zh.admin.participants.regenerateConfirm}
                      description={zh.admin.participants.regenerateConfirmBody}
                      okText={zh.admin.common.confirm}
                      cancelText={zh.admin.common.cancel}
                      onConfirm={() => regenerateMutation.mutate(row)}
                    >
                      <Button size="small" type="link" style={{ padding: 0 }}>
                        {zh.admin.participants.regenerateCode}
                      </Button>
                    </Popconfirm>

                    <Popconfirm
                      title={zh.admin.participants.resetConfirm}
                      description={zh.admin.participants.resetConfirmBody}
                      okText={zh.admin.common.confirm}
                      cancelText={zh.admin.common.cancel}
                      onConfirm={() => resetMutation.mutate(row)}
                    >
                      <Button size="small" type="link" style={{ padding: 0 }}>
                        {zh.admin.participants.resetPassword}
                      </Button>
                    </Popconfirm>

                    <Popconfirm
                      title={
                        row.status === 'disabled'
                          ? zh.admin.participants.enable
                          : zh.admin.participants.disableConfirm
                      }
                      description={
                        row.status === 'disabled' ? undefined : zh.admin.participants.disableConfirmBody
                      }
                      okText={zh.admin.common.confirm}
                      cancelText={zh.admin.common.cancel}
                      onConfirm={() =>
                        statusMutation.mutate({
                          participant: row,
                          status: row.status === 'disabled' ? 'active' : 'disabled',
                        })
                      }
                    >
                      <Button size="small" type="link" danger={row.status !== 'disabled'} style={{ padding: 0 }}>
                        {row.status === 'disabled'
                          ? zh.admin.participants.enable
                          : zh.admin.participants.disable}
                      </Button>
                    </Popconfirm>

                    <Button
                      size="small"
                      type="link"
                      danger
                      style={{ padding: 0 }}
                      onClick={() => {
                        setAnonymizeReason('')
                        setDeleteEvidence(true)
                        setAnonymizing(row)
                      }}
                    >
                      {zh.admin.participants.anonymize}
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </Card>

      <ImportParticipantsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={invalidate}
      />

      <AddParticipantModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={invalidate} />

      {secret && (
        <ActivationCodeModal
          open
          title={secret.title}
          warning={secret.warning}
          secrets={secret.entries}
          fileName={secret.fileName}
          onClose={() => setSecret(null)}
        />
      )}

      <ReasonModal
        open={anonymizing !== null}
        title={`${zh.admin.participants.anonymize}：${anonymizing?.name ?? ''}`}
        consequence={
          <>
            <Typography.Paragraph>{zh.admin.participants.anonymizeConsequence}</Typography.Paragraph>
            <Checkbox checked={deleteEvidence} onChange={(event) => setDeleteEvidence(event.target.checked)}>
              {zh.admin.participants.anonymizeDeleteEvidence}
            </Checkbox>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {zh.admin.participants.anonymizeDeleteEvidenceHint}
            </Typography.Text>
          </>
        }
        confirmText={zh.admin.participants.anonymizeConfirm}
        danger
        loading={anonymizeMutation.isPending}
        reason={anonymizeReason}
        onReasonChange={setAnonymizeReason}
        onSubmit={() => {
          if (!anonymizing) return
          anonymizeMutation.mutate({
            participant: anonymizing,
            reason: anonymizeReason.trim(),
            deleteEvidence,
          })
        }}
        onCancel={() => setAnonymizing(null)}
      />
    </Space>
  )
}
