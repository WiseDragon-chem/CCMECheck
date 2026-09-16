import { useEffect, useState } from 'react'
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
import { paths } from '@/routes/paths'
import ImagePicker, { type SelectedImage } from '../components/ImagePicker'
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
   */
  const [clientToken, setClientToken] = useState(() => newClientToken())
  useEffect(() => {
    setClientToken(newClientToken())
  }, [images, note])

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
      if (result.idempotent_replay) message.info('这次提交此前已经完成')
      else message.success('已提交，等待审核')

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
          title="没能加载打卡信息"
          subTitle="请检查网络后重试。"
          extra={<a onClick={() => void todayQuery.refetch()}>重新加载</a>}
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
          title="赛道不存在"
          subTitle="该赛道不在此活动中，或已停用。"
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>回到首页</Button>}
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
          title={displayState === 'approved' ? '该记录已审核通过' : '该记录已失效'}
          subTitle={
            displayState === 'approved'
              ? '如需修改，请联系管理员重新打开该记录。'
              : '该记录已被管理员处置，无法再次提交。'
          }
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>回到首页</Button>}
        />
      </div>
    )
  }

  if (displayState === 'submit_closed' || displayState === 'missed') {
    return (
      <div className="page">
        <Result
          status="warning"
          title={displayState === 'submit_closed' ? '活动已停止提交' : '今日打卡已截止'}
          subTitle="本活动日的打卡不能再提交或修改。"
          extra={<Button type="primary" onClick={() => navigate(paths.home)}>回到首页</Button>}
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
          {remainingSeconds !== null && remainingSeconds > 0 && ` · 距截止 ${formatRemaining(remainingSeconds)}`}
        </Typography.Text>
      </Space>

      {reopenExpiresAt && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`管理员已临时重新开放至 ${formatCstTime(reopenExpiresAt)}`}
          description="请在此时间前完成提交。"
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
          message="有效证明要求"
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{trackConfig.proof_instructions}</span>}
        />
      )}

      <Card size="small" title="证明材料" style={{ marginBottom: 16 }}>
        <ImagePicker value={images} onChange={setImages} rules={rules} disabled={submitting} />
      </Card>

      <Card size="small" title="文字备注" style={{ marginBottom: 16 }}>
        <Input.TextArea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="可选，补充说明本次打卡的内容"
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
            {percent < 100 ? '正在上传证明材料…' : '服务器正在处理图片…'}
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
        {submit.isError ? '重试提交' : '提交'}
      </Button>

      {tooFew && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 8 }}>
          至少需要 {rules.min_images} 张证明材料
        </Typography.Text>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 24 }}>
        提交后可在今日截止前重新提交，审核仅以最新一次为准。
      </Typography.Paragraph>
    </div>
  )
}
