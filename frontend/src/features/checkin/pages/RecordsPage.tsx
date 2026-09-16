import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Empty, Result, Segmented, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { fetchCheckins } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import type { CheckinListItem } from '@/api/types'
import { formatActivityDate, formatCstFriendly } from '@/lib/datetime'
import { paths } from '@/routes/paths'
import { CHECKIN_STATUS_META, type EntryStatusKey } from '../statusMeta'

/**
 * 打卡记录（design.md §7.5）。
 *
 * 手机优先的列表，不是表格 —— 表格在 375px 上没法看。
 * 按日期倒序，支持按赛道与状态筛选。
 */
const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: 'revoked', label: '已撤销' },
  { value: 'void', label: '已作废' },
]

export default function RecordsPage() {
  const navigate = useNavigate()
  const [track, setTrack] = useState('')
  const [status, setStatus] = useState<EntryStatusKey | ''>('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const campaignQuery = useQuery({ queryKey: qk.campaign, queryFn: fetchCurrentCampaign, staleTime: Infinity })

  // 用 limit 而不是 page：加载更多对参赛者比翻页自然，
  // 而且手机上不需要记住「我翻到第几页了」
  const query = useMemo(
    () => ({
      ...(track ? { track } : {}),
      ...(status ? { status } : {}),
      page: 1,
      page_size: limit,
    }),
    [track, status, limit],
  )

  const listQuery = useQuery({
    queryKey: [...qk.checkinList({ track, status }), limit],
    queryFn: () => fetchCheckins(query),
  })

  const trackOptions = useMemo(() => {
    const tracks = (campaignQuery.data?.tracks ?? []).filter((item) => item.enabled)
    return [{ value: '', label: '全部赛道' }, ...tracks.map((item) => ({ value: item.slug, label: item.name }))]
  }, [campaignQuery.data])

  if (listQuery.isPending || campaignQuery.isPending) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (listQuery.isError || !listQuery.data) {
    return (
      <div className="page">
        <Result
          status="warning"
          title="没能加载打卡记录"
          subTitle="请检查网络后重试。"
          extra={<a onClick={() => void listQuery.refetch()}>重新加载</a>}
        />
      </div>
    )
  }

  const { items, total } = listQuery.data
  const hasFilter = Boolean(track || status)

  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 12 }}>
        打卡记录
      </Typography.Title>

      <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
        {/* 赛道数量少，用分段控件比下拉更一目了然 */}
        {trackOptions.length > 1 && (
          <Segmented
            block
            value={track}
            onChange={(value) => {
              setTrack(String(value))
              setLimit(PAGE_SIZE)
            }}
            options={trackOptions}
          />
        )}
        <Select
          style={{ width: '100%' }}
          value={status}
          onChange={(value) => {
            setStatus(value as EntryStatusKey | '')
            setLimit(PAGE_SIZE)
          }}
          options={STATUS_OPTIONS}
        />
      </Space>

      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            hasFilter ? (
              <span>
                当前筛选条件下没有记录。
                <br />
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setTrack('')
                    setStatus('')
                    setLimit(PAGE_SIZE)
                  }}
                >
                  清除筛选
                </Button>
              </span>
            ) : (
              '还没有打卡记录，去首页完成第一次打卡吧。'
            )
          }
        />
      ) : (
        <>
          {items.map((item) => (
            <RecordRow key={item.entry_id} item={item} onOpen={() => navigate(paths.recordDetail(item.entry_id))} />
          ))}

          {total > items.length && (
            <Button block style={{ marginTop: 4 }} onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              加载更多（已显示 {items.length} / {total}）
            </Button>
          )}

          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            共 {total} 条记录
          </Typography.Text>
        </>
      )}
    </div>
  )
}

function RecordRow({ item, onOpen }: { item: CheckinListItem; onOpen: () => void }) {
  const meta = CHECKIN_STATUS_META[item.status]

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, borderLeft: `3px solid ${meta.color}` }}
      styles={{ body: { padding: 12 } }}
      onClick={onOpen}
      hoverable
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Space size={8}>
            <Typography.Text strong>{item.track.name}</Typography.Text>
            {/* 状态：颜色 + 图标 + 文字，与主页卡片同一套纪律 */}
            <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
              {meta.label}
            </Tag>
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatActivityDate(item.activity_date)} · 提交于 {formatCstFriendly(item.submitted_at)}
          </Typography.Text>

          {/* 驳回原因必须回显给参赛者（§16.6） */}
          {item.status === 'rejected' && item.rejection_reason && (
            <Typography.Text style={{ fontSize: 12, color: '#ff4d4f' }}>
              驳回原因：{item.rejection_reason}
            </Typography.Text>
          )}
        </Space>

        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.asset_count} 张
          </Typography.Text>
          <RightOutlined style={{ fontSize: 12, color: 'rgba(0,0,0,0.25)' }} />
        </Space>
      </div>
    </Card>
  )
}
