import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { presentError } from '@/api/presentError'
import { invalidationMap, qk } from '@/api/queryKeys'
import type { DashboardStats, DashboardWarning, JobRun, JobStatus, ScheduledJob, TrackStat } from '@/api/types'
import LoadError from '@/components/LoadError'
import { formatCst, formatRemaining } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { useAuthStore } from '@/stores/auth.store'
import { fetchDashboard, fetchJobRuns, triggerJob } from '../api/misc'
import { useCountdown } from '../hooks/useCountdown'

/**
 * 后台首页（design.md §8.1）。
 *
 * 一屏回答三个问题：现在有多少活、榜单什么时候更新、有没有东西坏了。
 * 所有数字来自**一次**请求 —— 拆成几个接口只会让几个卡片先后跳数，
 * 而管理员打开首页就是要在一屏里看全。
 *
 * 「需要关注」那一块是这一页真正的价值：没有人会每天来数待审核数，
 * 但所有人都想在任务失败时立刻知道，且是在它变成事故之前。
 */

const STATUS_COLOR: Record<JobStatus, string> = {
  running: 'processing',
  success: 'green',
  failed: 'red',
  skipped_locked: 'default',
}

export default function DashboardPage() {
  const { message, modal } = AntdApp.useApp()
  const queryClient = useQueryClient()
  // 手动触发任务是超管专属（后端 /admin/jobs 挂的是 super_admin）
  const isSuperAdmin = useAuthStore((state) => state.user?.role === 'super_admin')

  const statsQuery = useQuery({
    queryKey: qk.admin.dashboard,
    queryFn: fetchDashboard,
  })

  const runsQuery = useQuery({
    queryKey: qk.admin.jobRuns({ page_size: 10 }),
    queryFn: () => fetchJobRuns({ page_size: 10 }),
    // 任务历史只在手动触发或整点任务时变，首页每分钟对一次表就够
    refetchInterval: 60_000,
  })

  const triggerMutation = useMutation({
    mutationFn: (name: ScheduledJob['name']) => triggerJob(name),
    onSuccess: (result) => {
      // 任务失败也返回 200：失败信息就是这次的执行结果。
      // 所以这里必须看 status，不能靠 catch —— 把两者混起来，
      // 「任务跑了但失败了」和「请求根本没发出去」就分不清了。
      if (result.status === 'failed') {
        message.error(`${zh.admin.dashboard.triggerFailed}：${result.error ?? ''}`)
      } else {
        message.success(zh.admin.dashboard.triggerDone(result.processed))
      }
      for (const key of invalidationMap.triggerJob) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (error) => message.error(presentError(error).text),
  })

  /**
   * 确认对话框走命令式调用，不落成 state。
   *
   * 用 state + 一个渲染 `modal.confirm` 的组件会踩到「渲染期产生副作用」：
   * 那个 confirm 每次重渲染都会被再打开一次。
   */
  const confirmTrigger = (job: ScheduledJob) => {
    modal.confirm({
      title: zh.admin.dashboard.triggerConfirmTitle(job.description),
      content: zh.admin.dashboard.triggerConfirmBody,
      okText: zh.admin.dashboard.trigger,
      cancelText: zh.admin.common.cancel,
      onOk: () => triggerMutation.mutateAsync(job.name).catch(() => undefined),
    })
  }

  if (statsQuery.isError) {
    return (
      <LoadError
        error={statsQuery.error}
        title={zh.admin.common.loadFailed}
        extra={<Button onClick={() => void statsQuery.refetch()}>{zh.common.retry}</Button>}
      />
    )
  }

  if (statsQuery.isPending) {
    return <Skeleton active paragraph={{ rows: 10 }} />
  }

  const stats = statsQuery.data
  const counts = stats.counts

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <StatTile
          title={zh.admin.dashboard.participants}
          value={counts.participants_total}
          hint={zh.admin.dashboard.participantsDetail(
            counts.participants_activated,
            counts.participants_pending_activation,
            counts.participants_disabled,
          )}
        />
        <StatTile title={zh.admin.dashboard.todaySubmitted} value={counts.today_submitted} />
        <StatTile
          title={zh.admin.dashboard.pendingReview}
          value={counts.pending_total}
          // 待审核是这一页唯一「等你去干活」的数字，有积压时标出来
          highlight={counts.pending_total > 0}
        />
        <StatTile title={zh.admin.dashboard.todayApproved} value={counts.today_approved} />
        <StatTile title={zh.admin.dashboard.todayRejected} value={counts.today_rejected} />
      </Row>

      {stats.warnings.length > 0 && (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>
            {zh.admin.dashboard.warnings}
          </Typography.Title>
          <Warnings warnings={stats.warnings} />
        </div>
      )}

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card size="small" title={zh.admin.dashboard.trackRates} styles={{ body: { paddingTop: 8 } }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {stats.tracks.map((track) => (
                <TrackRateRow key={track.slug} track={track} />
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={zh.admin.dashboard.nextLeaderboard}
            styles={{ body: { paddingTop: 12 } }}
          >
            <LeaderboardPanel stats={stats} fetchedAt={statsQuery.dataUpdatedAt} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card size="small" title={zh.admin.dashboard.scheduledJobs} styles={{ body: { padding: 0 } }}>
            <Table<ScheduledJob>
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={stats.scheduled_jobs}
              columns={[
                {
                  title: zh.admin.dashboard.jobName,
                  dataIndex: 'description',
                  ellipsis: true,
                },
                {
                  title: zh.admin.dashboard.jobExpression,
                  dataIndex: 'expression',
                  width: 120,
                  render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
                },
                {
                  title: '',
                  width: 110,
                  align: 'right',
                  render: (_value, job) => (
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      disabled={!isSuperAdmin}
                      onClick={() => confirmTrigger(job)}
                    >
                      {zh.admin.dashboard.trigger}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={zh.admin.dashboard.recentRuns}
            styles={{ body: { padding: 0 } }}
            extra={
              <Button
                size="small"
                type="text"
                aria-label={zh.admin.common.refresh}
                icon={<ReloadOutlined />}
                onClick={() => void runsQuery.refetch()}
              />
            }
          >
            <RecentRuns items={runsQuery.data?.items ?? []} isPending={runsQuery.isPending} />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

function StatTile({
  title,
  value,
  hint,
  highlight,
}: {
  title: string
  value: number
  hint?: string
  highlight?: boolean
}) {
  return (
    // 五个磁贴按可用宽度自动折行，不写死 24/5 —— 那不是整数，写死会留一条空档
    <Col flex="1 1 180px" style={{ marginBottom: 16 }}>
      <Card size="small">
        <Statistic
          title={title}
          value={value}
          valueStyle={highlight ? { color: '#faad14' } : undefined}
        />
        {hint && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {hint}
          </Typography.Text>
        )}
      </Card>
    </Col>
  )
}

function TrackRateRow({ track }: { track: TrackStat }) {
  return (
    <div>
      <Space size={8} style={{ marginBottom: 2 }}>
        <Typography.Text>{track.name}</Typography.Text>
        {!track.enabled && <Tag>{zh.admin.dashboard.trackDisabled}</Tag>}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {zh.admin.dashboard.trackRow(track.submitted_today)}
        </Typography.Text>
      </Space>
      <Progress
        percent={Math.round(track.submission_rate * 1000) / 10}
        format={() => zh.admin.dashboard.submissionRate(track.submission_rate)}
        status={track.enabled ? 'normal' : 'exception'}
        strokeWidth={8}
      />
    </div>
  )
}

function LeaderboardPanel({ stats, fetchedAt }: { stats: DashboardStats; fetchedAt: number }) {
  const board = stats.leaderboard
  // 服务端给的剩余秒数是「响应生成那一刻」的，页面停着不动它就不动了
  const remaining = useCountdown(board.seconds_until_next_update, fetchedAt)

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {board.next_update_at ? (
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {remaining === null ? '—' : formatRemaining(remaining)}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {zh.admin.dashboard.nextUpdateAt(formatCst(board.next_update_at))}
          </Typography.Text>
        </div>
      ) : (
        <Typography.Text type="secondary">{zh.admin.dashboard.noJobRun}</Typography.Text>
      )}

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {zh.admin.dashboard.snapshot}
        </Typography.Text>
        {board.latest_snapshot ? (
          <div>
            <Space size={6}>
              <Typography.Text>
                {zh.admin.dashboard.snapshotCutoff(board.latest_snapshot.cutoff_date)}
              </Typography.Text>
              {board.latest_snapshot.is_final && (
                <Tag color="gold">{zh.admin.dashboard.snapshotFinal}</Tag>
              )}
            </Space>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {zh.admin.dashboard.snapshotAt(formatCst(board.latest_snapshot.generated_at))}
              </Typography.Text>
            </div>
          </div>
        ) : (
          <div>
            <Typography.Text type="secondary">{zh.admin.dashboard.noSnapshot}</Typography.Text>
          </div>
        )}
      </div>
    </Space>
  )
}

function RecentRuns({ items, isPending }: { items: JobRun[]; isPending: boolean }) {
  if (isPending) {
    return (
      <div style={{ padding: 12 }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={zh.admin.dashboard.runsEmpty} />
      </div>
    )
  }

  return (
    <Table<JobRun>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={items}
      columns={[
        {
          title: zh.admin.dashboard.jobName,
          dataIndex: 'job_name',
          render: (value: string, run) => (
            <Space direction="vertical" size={0}>
              <Typography.Text style={{ fontSize: 13 }}>{value}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {zh.admin.dashboard.runWindow(
                  formatCst(run.started_at),
                  run.finished_at ? formatCst(run.finished_at) : null,
                )}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: '',
          width: 150,
          align: 'right',
          render: (_value, run) => (
            <Space size={4}>
              {/* 手动触发的任务要能看出是谁按的，否则和审计日志对不上 */}
              {run.trigger === 'manual' && (
                <Tag style={{ marginInlineEnd: 0 }}>
                  {zh.admin.dashboard.jobTrigger.manual}
                  {run.triggered_by ? ` · ${run.triggered_by.name}` : ''}
                </Tag>
              )}
              <Tag color={STATUS_COLOR[run.status]} style={{ marginInlineEnd: 0 }}>
                {zh.admin.dashboard.jobStatus[run.status]}
              </Tag>
            </Space>
          ),
        },
      ]}
    />
  )
}

function Warnings({ warnings }: { warnings: DashboardWarning[] }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {warnings.map((warning) => (
        <Alert
          key={`${warning.kind}-${warning.at}`}
          type={warning.kind === 'pending_before_freeze' ? 'warning' : 'error'}
          showIcon
          message={
            zh.admin.dashboard.warningKind[
              warning.kind as keyof typeof zh.admin.dashboard.warningKind
            ] ?? warning.kind
          }
          description={warning.message}
        />
      ))}
    </Space>
  )
}
