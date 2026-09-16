import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Result, Skeleton, Tabs, Tag, Typography } from 'antd'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { fetchLeaderboard } from '@/api/endpoints/leaderboard'
import { qk } from '@/api/queryKeys'
import type { LeaderboardRow } from '@/api/types'
import { formatCst } from '@/lib/datetime'
import { formatScore } from '@/lib/milli'

/**
 * 排行榜（design.md §7.6）。
 *
 * 四个标签页：读书、单词、健身、总榜。
 * 名次由后端按 §9.3 的规则算好，前端只负责展示 ——
 * 尤其是**并列名次会出现重复序号**（1,1,3），列表不能按索引编号。
 */

const PAGE_SIZE = 50
const OVERALL = '__overall__'

export default function LeaderboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [limit, setLimit] = useState(PAGE_SIZE)

  const campaignQuery = useQuery({ queryKey: qk.campaign, queryFn: fetchCurrentCampaign, staleTime: Infinity })

  // 赛道列表取自活动配置并过滤启用状态 —— 不写死三个 slug，
  // 赛道是可以在后台停用的
  const tracks = useMemo(
    () => (campaignQuery.data?.tracks ?? []).filter((track) => track.enabled),
    [campaignQuery.data],
  )

  const activeTab = searchParams.get('tab') ?? OVERALL
  const trackSlug = activeTab === OVERALL ? undefined : activeTab

  const leaderboardQuery = useQuery({
    queryKey: qk.leaderboard(trackSlug),
    queryFn: () => fetchLeaderboard({ track: trackSlug, limit }),
    // 快照一天才更新一次，不必频繁重取
    staleTime: 5 * 60_000,
  })

  if (campaignQuery.isPending || leaderboardQuery.isPending) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    )
  }

  if (campaignQuery.isError || leaderboardQuery.isError || !leaderboardQuery.data) {
    return (
      <div className="page">
        <Result
          status="warning"
          title="没能加载排行榜"
          subTitle="请检查网络后重试。"
          extra={<a onClick={() => void leaderboardQuery.refetch()}>重新加载</a>}
        />
      </div>
    )
  }

  const data = leaderboardQuery.data
  const campaign = campaignQuery.data.campaign

  const tabs = [
    ...tracks.map((track) => ({ key: track.slug, label: track.name })),
    { key: OVERALL, label: '总榜' },
  ]

  return (
    <div className="page">
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
        排行榜
      </Typography.Title>

      {/*
        排行榜只在配置的时间更新一次，刚被审核通过的记录当天不会体现。
        这是本产品最高频的疑问，一行说明就能挡掉。
      */}
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        每日 {campaign.leaderboard_time} 更新，已通过的记录将在下次更新后计入
      </Typography.Text>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setLimit(PAGE_SIZE)
          setSearchParams(key === OVERALL ? {} : { tab: key }, { replace: true })
        }}
        items={tabs.map((tab) => ({ key: tab.key, label: tab.label }))}
      />

      <SnapshotHeader
        snapshot={data.snapshot}
        countedThrough={data.counted_through}
      />

      {data.rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            data.snapshot === null
              ? '排行榜尚未生成，请等待管理员完成第一次统计。'
              : '这个榜单暂时没有数据。'
          }
        />
      ) : (
        <>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {data.rows.map((row) => (
              <LeaderboardRowItem key={row.participant_id} row={row} />
            ))}
          </Card>

          {data.total > data.rows.length && (
            <Button
              block
              style={{ marginTop: 12 }}
              onClick={() => setLimit((value) => value + PAGE_SIZE)}
              loading={leaderboardQuery.isFetching}
            >
              加载更多（已显示 {data.rows.length} / {data.total}）
            </Button>
          )}

          {/*
            自己不在当前加载范围内时，底部固定显示我的名次，
            否则用户在几百人的榜单里翻不到自己。
          */}
          {data.me && !data.rows.some((row) => row.is_me) && (
            <div className="my-rank-bar">
              <LeaderboardRowItem row={data.me.row} compact />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SnapshotHeader({
  snapshot,
  countedThrough,
}: {
  snapshot: { generated_at: string; is_final: boolean; status: string } | null
  countedThrough: string | null
}) {
  if (!snapshot) return null

  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        统计至 {countedThrough} · 生成于 {formatCst(snapshot.generated_at)}
        {snapshot.is_final && (
          <Tag color="gold" style={{ marginLeft: 8 }}>
            最终榜单
          </Tag>
        )}
      </Typography.Text>

      {snapshot.status === 'failed' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message="最近一次快照生成失败，当前显示的仍是上一份有效数据。"
        />
      )}
    </div>
  )
}

function LeaderboardRowItem({ row, compact }: { row: LeaderboardRow; compact?: boolean }) {
  return (
    <div className={`lb-row${row.is_me ? ' is-me' : ''}${compact ? ' is-compact' : ''}`}>
      {/* 名次可能重复（同分并列），所以直接展示后端给的 rank，不按索引编号 */}
      <span className="lb-row__rank">{row.rank}</span>

      <div className="lb-row__who">
        <span className="lb-row__name">
          {row.name}
          {/*
            本人高亮不能只靠颜色 —— 除了左侧色条和底色，再加一个「我」标记，
            与卡片状态一样遵守「颜色不是唯一区分手段」的规则。
          */}
          {row.is_me && (
            <Tag color="blue" style={{ marginLeft: 6 }}>
              我
            </Tag>
          )}
        </span>
        <span className="lb-row__meta">
          {row.class_name ?? '—'} · 有效 {row.valid_days} 天
        </span>
      </div>

      <span className="lb-row__score">{formatScore(row.score)}</span>
    </div>
  )
}
