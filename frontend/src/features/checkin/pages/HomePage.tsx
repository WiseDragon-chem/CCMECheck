import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Empty, Result, Skeleton, Space, Typography } from 'antd'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { fetchToday } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import type { TodayCard } from '@/api/types'
import { serverNow, syncServerClock, useTicker } from '@/hooks/useServerClock'
import { formatActivityDate, formatRemaining } from '@/lib/datetime'
import { paths } from '@/routes/paths'
import { resolveCardDisplayState } from '../cardStateMeta'
import TrackCard from '../components/TrackCard'

/**
 * 主页面（design.md §7.3）—— 参赛者每天打开的那一屏。
 *
 * 目标是「一分钟内完成打卡」（§3 第 1 条），所以这一屏要在一屏之内
 * 展示完三张卡片的全部关键信息，且状态一眼可辨。
 */
export default function HomePage() {
  const navigate = useNavigate()
  // 每秒触发一次重算。时间本身取 serverNow()，不用设备时钟。
  const tick = useTicker(1000)

  const campaignQuery = useQuery({
    queryKey: qk.campaign,
    queryFn: fetchCurrentCampaign,
    // 活动配置在一次会话内基本不变，不必反复取
    staleTime: Infinity,
  })

  const todayQuery = useQuery({
    queryKey: qk.today,
    queryFn: fetchToday,
    // 卡片状态变化快（提交、审核、过截止时刻），比全局默认更短
    staleTime: 15_000,
  })

  // 每次拿到响应都校准一次本地时钟
  useEffect(() => {
    if (todayQuery.data) syncServerClock(todayQuery.data.server_time)
    else if (campaignQuery.data) syncServerClock(campaignQuery.data.server_time)
  }, [todayQuery.data, campaignQuery.data])

  /**
   * 实时剩余秒数。
   *
   * 响应里的 `seconds_to_deadline` 是**那一刻的快照**，直接展示的话它永远不动。
   * 要用它和 `server_time` 反推出截止的绝对时刻，再减去校正后的当前时间。
   */
  const secondsToDeadline = useMemo(() => {
    const data = todayQuery.data
    if (!data || data.seconds_to_deadline === null) return null
    const deadlineMs = Date.parse(data.server_time) + data.seconds_to_deadline * 1000
    return Math.max(0, Math.floor((deadlineMs - serverNow()) / 1000))
    // tick 让这个值每秒重算一次
  }, [todayQuery.data, tick])

  /**
   * 倒计时归零时重新拉取，让服务器给结论。
   *
   * §7.3 说倒计时只作提示、服务器时间负责最终判定 ——
   * 所以本地归零时**不能自己把按钮改成不可用**，那等于用设备时钟做了判定。
   * 正确的做法是问服务器。用 ref 记住已经问过，避免归零后每秒重复请求。
   */
  const refetchedForDeadline = useRef(false)
  useEffect(() => {
    if (secondsToDeadline === null) return
    if (secondsToDeadline > 0) {
      refetchedForDeadline.current = false
      return
    }
    if (refetchedForDeadline.current) return
    refetchedForDeadline.current = true
    void todayQuery.refetch()
  }, [secondsToDeadline, todayQuery])

  if (todayQuery.isPending || campaignQuery.isPending) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 2 }} />
        <Skeleton active paragraph={{ rows: 3 }} style={{ marginTop: 16 }} />
      </div>
    )
  }

  if (todayQuery.isError || campaignQuery.isError || !todayQuery.data || !campaignQuery.data) {
    return (
      <div className="page">
        <Result
          status="warning"
          title="没能加载今日打卡"
          subTitle="请检查网络后重试。"
          extra={<a onClick={() => void todayQuery.refetch()}>重新加载</a>}
        />
      </div>
    )
  }

  const today = todayQuery.data
  const campaign = campaignQuery.data.campaign
  const notActive = campaign.status !== 'active'

  const handleAction = (action: 'submit' | 'resubmit' | 'detail', card: TodayCard) => {
    if (action === 'detail') {
      if (card.entry_id) navigate(paths.recordDetail(card.entry_id))
      else navigate(paths.records)
      return
    }
    navigate(paths.submit(card.slug))
  }

  // 审核员与超管可能本身不是参赛者，此时 cards 为空 ——
  // 这是一个独立的空状态，既不是加载中，也不是错误
  if (!today.is_participant) {
    return (
      <div className="page">
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {campaign.name}
        </Typography.Title>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              当前账号不是本次活动的参赛者。
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                如需参赛，请联系管理员把你加入参赛名单。
              </Typography.Text>
            </span>
          }
        />
      </div>
    )
  }

  const remaining =
    secondsToDeadline !== null && secondsToDeadline > 0 ? formatRemaining(secondsToDeadline) : null

  return (
    <div className="page">
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {campaign.name}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {formatActivityDate(today.activity_date)} · 累计有效 {today.total_valid_days} 天
        </Typography.Text>
        {remaining && (
          <Typography.Text style={{ fontSize: 13, color: '#faad14' }}>
            距今日截止 {remaining}
          </Typography.Text>
        )}
      </Space>

      {/*
        活动不在进行中时先把原因说清楚，再展示卡片。
        没有这条横幅的话，用户只会看到一堆不可操作的卡片而不知道发生了什么。
      */}
      {notActive && (
        <Alert
          type={campaign.status === 'settling' ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            campaign.status === 'settling'
              ? '活动已进入结算阶段，停止提交打卡'
              : campaign.status === 'finished'
                ? '活动已结束'
                : '活动当前未开放打卡'
          }
          description="已有记录的审核结果仍可查看。"
        />
      )}

      {today.cards.map((card) => (
        <TrackCard
          key={card.slug}
          card={card}
          displayState={resolveCardDisplayState(card, campaign.status)}
          secondsToDeadline={secondsToDeadline}
          deadlineText={campaign.daily_deadline}
          onAction={handleAction}
        />
      ))}

      {/* 排行榜是每日快照，这条说明能挡掉「我刚通过为什么榜上没变」这一类疑问 */}
      {campaign.leaderboard_visible && (
        <Card size="small" style={{ marginTop: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            排行榜每日 {campaign.leaderboard_time} 更新，今日通过的记录将在下次更新后计入。
          </Typography.Text>
        </Card>
      )}

    </div>
  )
}
