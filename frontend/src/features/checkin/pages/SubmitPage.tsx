import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntdApp, Button, Card, Input, Progress, Result, Skeleton, Space, Typography } from 'antd'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { fetchToday } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import { presentError } from '@/api/presentError'
import { submitCheckin } from '@/api/upload'
import { serverNow, syncServerClock, useTicker } from '@/hooks/useServerClock'
import { newClientToken } from '@/lib/clientToken'
import { formatActivityDate, formatCstTime, formatRemaining } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import ImagePicker from '../components/ImagePicker'
import type { SelectedImage } from '../components/imagePicker.utils'
import { resolveCardDisplayState } from '../cardStateMeta'

/**
 * 提交打卡（design.md §7.4）。
 *
 * 这一屏是「一分钟完成打卡」这个目标真正被检验的地方，
 * 所以要求说明放在最显眼处、选图即预览、提交有进度、成功后明确回到主页。
 */
export default function SubmitPage() {
  const { track = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntdApp.useApp()
  useTicker(1000)

  const [images, setImages] = useState<SelectedImage[]>([])
  const [note, setNote] = useState('')
  const [percent, setPercent] = useState(0)

  /**
   * 幂等键（§7.4 防重复点击）。
   *
   * 关键点：**内容变了就必须换一个键**。
   * 服务端按 (entry_id, client_token) 去重，命中就原样返回那一版 ——
   * 如果改完图片还沿用旧键，提交会「成功」但存进去的是上一次的图片，
   * 而且不会有任何报错。这是最隐蔽的一类 bug。
   *
   * 反过来，内容没变时（比如网络失败后重试）保持同一个键，
   * 才是真正的防重复提交。
   *
   * 用 useMemo 而不是「state + effect 里 setState」：后者会在每次内容变化时
   * 触发一次额外的渲染，而且 react-hooks 明确禁止在 effect 里同步 setState。
   * useMemo 的语义正好对得上这里的需求 —— 依赖不变就复用，变了才重新生成。
   *
   * 理论上 React 可以丢弃 memo 重算，那会为同样的内容生成一个新键，
   * 后果是同一槽位多出一个内容相同的版本 —— 不会错数据，只是多一条历史。
   *
   * eslint-disable-next-line：这两个依赖**不是**回调里用到的值，
   * 而是「内容变了就换键」的触发器本身。exhaustive-deps 判断的是
   * 「依赖有没有在回调里用到」，无法表达「仅作为失效信号」这种用法。
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientToken = useMemo(() => newClientToken(), [images, note])

  const campaignQuery = useQuery({ queryKey: qk.campaign, queryFn: fetchCurrentCampaign, staleTime: Infinity })
  const todayQuery = useQuery({ queryKey: qk.today, queryFn: fetchToday, staleTime: 15_000 })

  useEffect(() => {
    if (todayQuery.data) syncServerClock(todayQuery.data.server_time)
    else if (campaignQuery.data) syncServerClock(campaignQuery.data.server_time)
  }, [todayQuery.data, campaignQuery.data])

  const submit = useMutation({
    mutationFn: () =>
      submitCheckin({
        track,
        activityDate: todayQuery.data?.activity_date ?? '',
        note: note.trim() || null,
        clientToken,
        images: images.map((image) => image.file),
        onProgress: setPercent,
      }),
    onSuccess: (result) => {
      // 命中幂等键说明上一次其实已经落库了，对用户来说同样是成功
      if (result.idempotent_replay) message.info(zh.checkin.submit.alreadySubmitted)
      else message.success(zh.checkin.submit.submitted)

      void queryClient.invalidateQueries({ queryKey: qk.today })
      void queryClient.invalidateQueries({ queryKey: ['checkins', 'list'] })
      navigate(paths.home, { replace: true })
    },
  })

  // object URL 的生命周期由 ImagePicker 负责（它用 ref 拿到最新列表再释放）。
  // 这里不要重复写一遍卸载清理 —— 依赖为 [] 的 effect 捕获到的是初始空数组，
  // 看着像在做清理，实际什么都不做。

  if (campaignQuery.isPending || todayQuery.isPending) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (campaignQuery.isError || todayQuery.isError || !campaignQuery.data || !todayQuery.data) {
    return (
      <div className="page">
        <Result
          status="warning"
          title={zh.checkin.submit.loadFailed}
          subTitle={zh.common.loadFailed}
          extra={<a onClick={() => void todayQuery.refetch()}>{zh.common.retry}</a>}
        />
      </div>
    )
  }

  const campaign = campaignQuery.data.campaign
  const trackConfig = campaignQuery.data.tracks.find((item) => item.slug === track)
  const card = todayQuery.data.cards.find((item) => item.slug === track)

  if (!trackConfig) {
    return (
      <div className="page">
        <Result
          status="404"
          title={zh.checkin.submit.trackNotFound}
          subTitle={zh.checkin.submit.trackNotFoundDetail}
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>{zh.common.backHome}</Button>}
        />
      </div>
    )
  }

  const displayState = card ? resolveCardDisplayState(card, campaign.status) : null

  // 已通过 / 已失效的记录参赛者不能自行修改 —— 与其让用户填完表单再被拒，
  // 不如提前把原因说清楚
  if (displayState === 'approved' || displayState === 'invalid') {
    return (
      <div className="page">
        <Result
          status="info"
          title={displayState === 'approved' ? zh.checkin.submit.alreadyApprovedTitle : zh.checkin.submit.invalidTitle}
          subTitle={
            displayState === 'approved'
              ? zh.checkin.submit.alreadyApprovedDetail
              : zh.checkin.submit.invalidDetail
          }
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>{zh.common.backHome}</Button>}
        />
      </div>
    )
  }

  if (displayState === 'submit_closed' || displayState === 'missed') {
    return (
      <div className="page">
        <Result
          status="warning"
          title={displayState === 'submit_closed' ? zh.checkin.submit.closedTitle : zh.checkin.submit.missedTitle}
          subTitle={zh.checkin.submit.closedDetail}
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>{zh.common.backHome}</Button>}
        />
      </div>
    )
  }

  const rules = campaign.upload_rules
  const remainingSeconds =
    todayQuery.data.seconds_to_deadline === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (Date.parse(todayQuery.data.server_time) + todayQuery.data.seconds_to_deadline * 1000 - serverNow()) /
              1000,
          ),
        )

  const reopenExpiresAt = card?.reopen_expires_at ?? null
  const submitting = submit.isPending
  const presented = submit.error ? presentError(submit.error) : null

  const tooFew = images.length < rules.min_images

  return (
    <div className="page">
      <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {trackConfig.name}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {formatActivityDate(todayQuery.data.activity_date)}
          {remainingSeconds !== null && remainingSeconds > 0 && zh.checkin.home.deadlineCountdownHint(formatRemaining(remainingSeconds))}
        </Typography.Text>
      </Space>

      {reopenExpiresAt && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={zh.checkin.submit.reopenBanner(formatCstTime(reopenExpiresAt))}
          description={zh.checkin.submit.reopenDetail}
        />
      )}

      {/*
        证明要求放在最显眼处，不是灰色小字。
        各赛道要求不同，看不清要求是本项目驳回的最主要来源。
      */}
      {trackConfig.proof_instructions && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={zh.checkin.submit.proofRequirement}
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{trackConfig.proof_instructions}</span>}
        />
      )}

      <Card size="small" title={zh.checkin.submit.materials} style={{ marginBottom: 16 }}>
        <ImagePicker value={images} onChange={setImages} rules={rules} disabled={submitting} />
      </Card>

      <Card size="small" title={zh.checkin.submit.note} style={{ marginBottom: 16 }}>
        <Input.TextArea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={zh.checkin.submit.notePlaceholder}
          maxLength={1000}
          showCount
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={submitting}
        />
      </Card>

      {presented && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={presented.text}
          description={
            presented.showRequestId && presented.requestId ? `追踪号 ${presented.requestId}` : undefined
          }
        />
      )}

      {submitting && (
        <div className="submit-progress">
          <Progress percent={percent} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {percent < 100 ? zh.checkin.submit.uploading : zh.checkin.submit.processing}
          </Typography.Text>
        </div>
      )}

      <Button
        type="primary"
        block
        size="large"
        loading={submitting}
        disabled={tooFew}
        onClick={() => submit.mutate()}
      >
        {submit.isError ? zh.common.retrySubmit : zh.common.submit}
      </Button>

      {tooFew && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 8 }}>
          {zh.checkin.submit.minImages(rules.min_images)}
        </Typography.Text>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 24 }}>
        {zh.checkin.submit.resubmittedNotice}
      </Typography.Paragraph>
    </div>
  )
}
