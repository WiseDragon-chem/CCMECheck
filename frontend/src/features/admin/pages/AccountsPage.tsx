import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
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
import { invalidationMap, qk } from '@/api/queryKeys'
import type { AdminAccount } from '@/api/types'
import LoadError from '@/components/LoadError'
import { formatCst } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { useAuthStore } from '@/stores/auth.store'
import { fetchAccountsList, resetAccountPassword, updateAccount } from '../api/accounts'
import ActivationCodeModal, { type OneTimeSecret } from '../components/ActivationCodeModal'
import AddAccountModal from '../components/AddAccountModal'

/**
 * 账号管理（design.md §5「管理管理员账号」）。
 *
 * 这一页有三处不能省的设计：
 *
 *   1. **被拦下的操作置灰并说明原因，而不是隐藏按钮。** 自我操作与
 *      「最后一个活跃超管」都会被服务端拒绝，但把按钮藏起来只会让人
 *      以为页面缺功能；灰着加一句解释，一眼就懂。
 *
 *   2. **活跃超管数写在页面上**（只剩 1 个时升级为警告条）。它是禁用/降级
 *      按钮变灰的原因 —— 不写出来就只是一个点不动的按钮。
 *
 *   3. **重置密码走 ActivationCodeModal**，不用 message 弹一下。明文只
 *      出现这一次，3 秒后消失的提示等于把它弄丢了。
 *
 * 「本人能做什么」也值得说清：改名不改变权限，因此允许；禁用、降级、
 * 重置密码则只能由其他超管发起（§5 账号管理）。
 */

const PAGE_SIZE = 20

interface Filters {
  keyword?: string
  role?: AdminAccount['role']
}

/**
 * 行内操作。
 *
 * `blockedReason` 有值时按钮置灰并把这句话显示在 Tooltip 里 ——
 * 禁用的按钮不触发鼠标事件，所以 Tooltip 得挂在外层元素上。
 */
function RowAction(props: {
  label: string
  danger?: boolean
  blockedReason?: string
  confirmTitle: string
  confirmBody?: string
  onConfirm: () => void
}) {
  const button = (
    <Button
      size="small"
      type="link"
      danger={props.danger}
      disabled={Boolean(props.blockedReason)}
      style={{ padding: 0 }}
    >
      {props.label}
    </Button>
  )

  if (props.blockedReason) {
    return (
      <Tooltip title={props.blockedReason}>
        <span>{button}</span>
      </Tooltip>
    )
  }

  return (
    <Popconfirm
      title={props.confirmTitle}
      description={props.confirmBody}
      okText={zh.admin.common.confirm}
      cancelText={zh.admin.common.cancel}
      onConfirm={props.onConfirm}
    >
      {button}
    </Popconfirm>
  )
}

export default function AccountsPage() {
  const { message } = AntdApp.useApp()
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((state) => state.user?.id)

  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>({})
  const [addOpen, setAddOpen] = useState(false)
  const [secret, setSecret] = useState<{ entries: OneTimeSecret[]; fileName: string } | null>(null)

  const query = useQuery({
    queryKey: qk.admin.accounts({ ...filters, page }),
    queryFn: () => fetchAccountsList({ ...filters, page, page_size: PAGE_SIZE }),
    // 后台账号是低频数据，切回来时重取一次就够
    staleTime: 30_000,
  })

  // 失效哪几个查询由 invalidationMap 集中决定；账号变动会影响审计列表，但不影响首页统计
  const invalidate = () => {
    for (const key of invalidationMap.accountManage) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const roleMutation = useMutation({
    mutationFn: (params: { account: AdminAccount; role: AdminAccount['role'] }) =>
      updateAccount(params.account.id, { role: params.role }),
    onSuccess: () => {
      message.success(zh.admin.accounts.roleDone)
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const statusMutation = useMutation({
    mutationFn: (params: { account: AdminAccount; status: 'active' | 'disabled' }) =>
      updateAccount(params.account.id, { status: params.status }),
    onSuccess: (result, params) => {
      message.success(
        params.status === 'disabled' ? zh.admin.accounts.disableDone : zh.admin.accounts.enableDone,
      )
      // 禁用会撤销对方的登录会话。这个数字值得说出来 ——
      // 管理员据此知道对方是不是正用着后台，从而决定要不要打个招呼
      if (result.revoked_sessions > 0) {
        message.info(zh.admin.accounts.disableRevoked(result.revoked_sessions))
      }
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

  const resetMutation = useMutation({
    mutationFn: (account: AdminAccount) => resetAccountPassword(account.id),
    onSuccess: (result) => {
      setSecret({
        entries: [
          {
            studentId: result.account.student_id,
            name: result.account.name,
            secret: result.password,
          },
        ],
        fileName: `password-${result.account.student_id}.csv`,
      })
      invalidate()
    },
    onError: (error) => message.error(presentError(error).text),
  })

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
  const hasFilters = Boolean(filters.keyword || filters.role)
  const activeSuperAdmins = query.data?.active_super_admin_count ?? 0

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {zh.admin.accounts.title}
        </Typography.Title>
        <Typography.Text type="secondary">{zh.admin.accounts.subtitle}</Typography.Text>
      </div>

      {query.data &&
        (activeSuperAdmins <= 1 ? (
          <Alert type="warning" showIcon message={zh.admin.accounts.lastSuperAdminAlert} />
        ) : (
          <Typography.Text type="secondary">
            {zh.admin.accounts.activeSuperAdminHint(activeSuperAdmins)}
          </Typography.Text>
        ))}

      <Card size="small" styles={{ body: { paddingBottom: 12 } }}>
        <Space wrap size={8}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            {zh.admin.accounts.add}
          </Button>
          <Input.Search
            allowClear
            style={{ width: 240 }}
            placeholder={zh.admin.accounts.search}
            onSearch={(value) => {
              setPage(1)
              setFilters((current) => ({ ...current, keyword: value || undefined }))
            }}
          />
          <Select
            allowClear
            style={{ width: 160 }}
            placeholder={zh.admin.accounts.allRoles}
            value={filters.role}
            onChange={(role) => {
              setPage(1)
              setFilters((current) => ({ ...current, role }))
            }}
            options={[
              { value: 'super_admin', label: zh.admin.accounts.roleLabel.super_admin },
              { value: 'reviewer', label: zh.admin.accounts.roleLabel.reviewer },
            ]}
          />
          <Button
            type="text"
            aria-label={zh.admin.common.refresh}
            icon={<ReloadOutlined />}
            onClick={() => void query.refetch()}
          />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<AdminAccount>
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
            emptyText: hasFilters ? zh.admin.accounts.emptyFiltered : zh.admin.accounts.empty,
          }}
          scroll={{ x: 900 }}
          columns={[
            { title: zh.admin.accounts.studentId, dataIndex: 'student_id', width: 130 },
            {
              title: zh.admin.accounts.name,
              dataIndex: 'name',
              width: 150,
              render: (value: string, row) => (
                <Space size={6}>
                  <span>{value}</span>
                  {row.id === currentUserId && (
                    <Tooltip title={zh.admin.accounts.selfRenameAllowedTip}>
                      <Tag color="blue">{zh.admin.accounts.self}</Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: zh.admin.accounts.role,
              dataIndex: 'role',
              width: 120,
              render: (value: AdminAccount['role']) => (
                <Tag color={value === 'super_admin' ? 'gold' : 'blue'}>
                  {zh.admin.accounts.roleLabel[value]}
                </Tag>
              ),
            },
            {
              title: zh.admin.accounts.status,
              dataIndex: 'status',
              width: 100,
              render: (value: AdminAccount['status']) => (
                <Tag color={value === 'active' ? 'green' : 'red'}>
                  {zh.admin.accounts.statusLabel[value]}
                </Tag>
              ),
            },
            {
              // 这一列回答的是「这个人还在用我们发的初始密码吗」
              title: zh.admin.accounts.passwordChangedAt,
              dataIndex: 'password_changed_at',
              width: 120,
              render: (value: string | null) =>
                value ? formatCst(value, 'YYYY-MM-DD') : zh.admin.accounts.neverChanged,
            },
            {
              title: zh.admin.accounts.createdAt,
              dataIndex: 'created_at',
              width: 120,
              render: (value: string) => formatCst(value, 'YYYY-MM-DD'),
            },
            {
              title: zh.admin.accounts.actions,
              key: 'actions',
              width: 280,
              fixed: 'right',
              render: (_value, row): ReactNode => {
                const isSelf = row.id === currentUserId
                // 只剩一个活跃超管时，它就是最后一根独苗：禁用或降级都会让所有人进不去后台
                const isLastSuperAdmin =
                  row.role === 'super_admin' && row.status === 'active' && activeSuperAdmins <= 1
                const privilegeBlock = isSelf
                  ? zh.admin.accounts.selfActionTip
                  : isLastSuperAdmin
                    ? zh.admin.accounts.lastSuperAdminTip
                    : undefined

                return (
                  <Space size={4} wrap>
                    {row.role === 'reviewer' ? (
                      // 提升不减少超管，任何情况下都允许
                      <RowAction
                        label={zh.admin.accounts.roleOptions.super_admin}
                        confirmTitle={zh.admin.accounts.roleConfirm(
                          zh.admin.accounts.roleOptions.super_admin,
                        )}
                        confirmBody={zh.admin.accounts.roleConfirmBody}
                        onConfirm={() => roleMutation.mutate({ account: row, role: 'super_admin' })}
                      />
                    ) : (
                      <RowAction
                        label={zh.admin.accounts.roleOptions.reviewer}
                        danger
                        blockedReason={privilegeBlock}
                        confirmTitle={zh.admin.accounts.roleConfirm(
                          zh.admin.accounts.roleOptions.reviewer,
                        )}
                        confirmBody={zh.admin.accounts.roleConfirmBody}
                        onConfirm={() => roleMutation.mutate({ account: row, role: 'reviewer' })}
                      />
                    )}

                    <RowAction
                      label={zh.admin.accounts.resetPassword}
                      danger
                      blockedReason={isSelf ? zh.admin.accounts.selfActionTip : undefined}
                      confirmTitle={zh.admin.accounts.resetConfirm}
                      confirmBody={zh.admin.accounts.resetConfirmBody}
                      onConfirm={() => resetMutation.mutate(row)}
                    />

                    {row.status === 'active' ? (
                      <RowAction
                        label={zh.admin.accounts.disable}
                        danger
                        blockedReason={privilegeBlock}
                        confirmTitle={zh.admin.accounts.disableConfirm}
                        confirmBody={zh.admin.accounts.disableConfirmBody}
                        onConfirm={() => statusMutation.mutate({ account: row, status: 'disabled' })}
                      />
                    ) : (
                      // 启用只会增加可用账号，不需要任何保护
                      <RowAction
                        label={zh.admin.accounts.enable}
                        confirmTitle={zh.admin.accounts.enable}
                        onConfirm={() => statusMutation.mutate({ account: row, status: 'active' })}
                      />
                    )}
                  </Space>
                )
              },
            },
          ]}
        />
      </Card>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={invalidate} />

      {secret && (
        <ActivationCodeModal
          open
          title={zh.admin.accounts.passwordTitle}
          warning={zh.admin.accounts.passwordWarning}
          secrets={secret.entries}
          fileName={secret.fileName}
          onClose={() => setSecret(null)}
        />
      )}
    </Space>
  )
}
