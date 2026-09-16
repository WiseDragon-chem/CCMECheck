import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Col, DatePicker, Form, Input, Row, Space, Table, Tag, Typography } from 'antd'
import { qk } from '@/api/queryKeys'
import type { AuditLogEntry } from '@/api/types'
import type { Dayjs } from 'dayjs'
import { formatCst, fromPickerDate } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { fetchAuditLogs } from '../api/misc'

/**
 * 审计日志（design.md §12.4、§8.5）。
 *
 * 这一屏是**只读**的，而且刻意如此：审计表只追加，界面不提供任何
 * 看起来能改它或删它的入口。一个「删除」按钮哪怕只是没接后端，
 * 也会让人以为审计可以清 —— 那正是审计最不能有的暗示。
 *
 * 筛选做成显式「查询」而不是输入即筛：审计表的查询是有代价的
 * （按时间范围扫），而且看日志的人通常是在**描述**一个事件
 * （「谁在什么时候改了这条记录」），不是边打边找。
 */

const PAGE_SIZE = 20

interface AuditFilters {
  actor_id?: string
  action?: string
  target_type?: string
  target_id?: string
  from?: string
  to?: string
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AuditFilters>({})

  const query = useQuery({
    queryKey: qk.admin.auditLogs({ ...filters, page }),
    queryFn: () => fetchAuditLogs({ ...filters, page, page_size: PAGE_SIZE }),
    // 审计日志是历史记录，不随时间变化的部分不必反复重取
    staleTime: 30_000,
  })

  const applyFilters = (values: AuditFilters & { range?: [unknown, unknown] }) => {
    setPage(1)
    setFilters({
      actor_id: values.actor_id,
      action: values.action,
      target_type: values.target_type,
      target_id: values.target_id,
      ...rangeToDates(values.range),
    })
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {zh.admin.audit.title}
        </Typography.Title>
        <Typography.Text type="secondary">{zh.admin.audit.subtitle}</Typography.Text>
      </div>

      <Card size="small">
        <Form layout="vertical" onFinish={applyFilters}>
          <Row gutter={12}>
            <Col xs={24} md={8} lg={4}>
              <Form.Item name="action" label={zh.admin.audit.action}>
                <Input allowClear placeholder={zh.admin.audit.actionPlaceholder} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} lg={4}>
              <Form.Item name="actor_id" label={zh.admin.audit.actor}>
                <Input allowClear placeholder={zh.admin.audit.actorPlaceholder} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} lg={4}>
              <Form.Item name="target_type" label={zh.admin.audit.targetType}>
                <Input allowClear placeholder={zh.admin.audit.targetTypePlaceholder} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} lg={4}>
              <Form.Item name="target_id" label={zh.admin.audit.targetId}>
                <Input allowClear placeholder={zh.admin.audit.targetIdPlaceholder} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} lg={5}>
              <Form.Item name="range" label={zh.admin.audit.dateRange}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} lg={3}>
              <Form.Item label=" ">
                <Space>
                  <Button type="primary" htmlType="submit">
                    {zh.admin.audit.query}
                  </Button>
                  <Button
                    onClick={() => {
                      setFilters({})
                      setPage(1)
                    }}
                  >
                    {zh.admin.audit.reset}
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<AuditLogEntry>
          size="small"
          rowKey="id"
          loading={query.isFetching}
          dataSource={query.data?.items ?? []}
          expandable={{
            // 没有 before/after 的行（例如登录、导出）不给展开箭头：
            // 展开一个空面板只会让人以为数据没加载出来
            rowExpandable: (record) => record.before !== null || record.after !== null,
            expandedRowRender: (record) => <DiffView entry={record} />,
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: query.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (total) => zh.admin.common.total(total),
          }}
          locale={{ emptyText: query.isError ? zh.admin.audit.loadFailed : zh.admin.common.empty }}
          columns={[
            {
              title: zh.admin.audit.time,
              dataIndex: 'created_at',
              width: 150,
              render: (value: string) => formatCst(value, 'MM-DD HH:mm:ss'),
            },
            {
              title: zh.admin.audit.actor,
              dataIndex: 'actor',
              width: 160,
              render: (_value, record) =>
                record.actor ? (
                  <Space direction="vertical" size={0}>
                    <Typography.Text style={{ fontSize: 13 }}>{record.actor.name}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {record.actor.student_id} · {record.actor.role}
                    </Typography.Text>
                  </Space>
                ) : (
                  // actor 为空是系统动作（定时任务、状态自动流转），
                  // 显示「—」会让人以为是数据缺失
                  <Tag>{zh.admin.audit.system}</Tag>
                ),
            },
            {
              title: zh.admin.audit.action,
              dataIndex: 'action',
              render: (value: string) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    {zh.admin.audit.actionLabel[value as keyof typeof zh.admin.audit.actionLabel] ??
                      value}
                  </Typography.Text>
                  {/* 中文名之外保留原始动作码：与后端日志对照时要用它 */}
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {value}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: zh.admin.audit.target,
              dataIndex: 'target_id',
              render: (_value, record) =>
                record.target_type || record.target_id ? (
                  <Space direction="vertical" size={0}>
                    <Typography.Text style={{ fontSize: 13 }}>
                      {record.target_type ?? '—'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }} copyable>
                      {record.target_id ?? '—'}
                    </Typography.Text>
                  </Space>
                ) : (
                  '—'
                ),
            },
            {
              title: zh.admin.audit.requestId,
              dataIndex: 'request_id',
              width: 140,
              render: (value: string | null) =>
                value ? (
                  <Typography.Text style={{ fontSize: 11 }} copyable>
                    {value}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
    </Space>
  )
}

/** 修改前后并排。JSON 原样展示 —— 审计的价值在于「原样」 */
function DiffView({ entry }: { entry: AuditLogEntry }) {
  const hasBefore = entry.before !== null
  const hasAfter = entry.after !== null

  if (!hasBefore && !hasAfter) {
    return <Typography.Text type="secondary">{zh.admin.audit.noChange}</Typography.Text>
  }

  return (
    <Row gutter={12}>
      <Col span={12}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {zh.admin.audit.before}
        </Typography.Text>
        <pre className="audit-diff">{formatPayload(entry.before)}</pre>
      </Col>
      <Col span={12}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {zh.admin.audit.after}
        </Typography.Text>
        <pre className="audit-diff">{formatPayload(entry.after)}</pre>
      </Col>
    </Row>
  )
}

/**
 * 审计表里存的是 JSON 字符串，服务端已经解过一层。
 *
 * 这里如实序列化，不做字段名翻译：审计记录是给「对照日志排查」用的，
 * 一份被美化过的副本反而对不上服务端的原始数据。
 */
function formatPayload(value: unknown): string {
  if (value === null || value === undefined) return zh.admin.audit.emptyValue
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** RangePicker 的值 → 两个 `YYYY-MM-DD`。用 fromPickerDate 而不是 toISOString() */
function rangeToDates(range: unknown): { from?: string; to?: string } {
  if (!Array.isArray(range) || range.length !== 2) return {}
  const [start, end] = range as [Dayjs | null, Dayjs | null]
  return { from: fromPickerDate(start), to: fromPickerDate(end) }
}
