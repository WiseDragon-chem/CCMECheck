import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Input,
  InputNumber,
  Progress,
  Radio,
  Result,
  Skeleton,
  Space,
  Typography,
} from 'antd'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { fetchToday } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import { presentError } from '@/api/presentError'
import { submitCheckin } from '@/api/upload'
import LoadError from '@/components/LoadError'
import { serverNow, syncServerClock, useTicker } from '@/hooks/useServerClock'
import { newClientToken } from '@/lib/clientToken'
import { formatActivityDate, formatCstTime, formatRemaining } from '@/lib/datetime'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import ImagePicker from '../components/ImagePicker'
import type { SelectedImage } from '../components/imagePicker.utils'
import { resolveCardDisplayState } from '../cardStateMeta'
import { exerciseTypeLabel } from '@/components/exerciseTypeMeta'
import { FITNESS_EXERCISE_TYPES, WORD_COUNT_MIN, isLenientImageTrack } from '../declaration'

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
  /**
   * 申报明细（design.md §9.1）：单词填数量，运动选类型，读书两者都不用。
   * 它们与图片、备注一样是**幂等键的一部分** —— 见下面 clientToken 的依赖数组。
   */
  const [wordCount, setWordCount] = useState<number | null>(null)
  const [exerciseType, setExerciseType] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)

  /**
   * 幂等键（§7.4 防重复点击）。
   *
   * 关键点：**内容变了就必须换一个键**。
   * 服务端按 (entry_id, client_token) 去重，命中就原样返回那一版 ——
   * 如果改完图片还沿用旧键，提交会「成功」但存进去的是上一次的图片，
   * 而且不会有任何报错。这是最隐蔽的一类 bug。
   * 申报明细同理：把单词数从 30 改成 50 而键没换，存进去的仍是 30 个，
   * 而且分值判定会安静地按 1 分算。
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
  const clientToken = useMemo(() => newClientToken(), [images, note, wordCount, exerciseType])

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
        // 只传本赛道认的那个字段：服务端 resolveDeclaration 也会清掉无关字段，
        // 但两边一致时错误信息更贴近用户实际做的事
        wordCount: track === 'vocabulary' ? wordCount : null,
        exerciseType: track === 'fitness' ? exerciseType : null,
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
      <div className="page page--readable">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (campaignQuery.isError || todayQuery.isError || !campaignQuery.data || !todayQuery.data) {
    return (
      <div className="page page--readable">
        <LoadError
          error={todayQuery.error ?? campaignQuery.error}
          title={zh.checkin.submit.loadFailed}
          extra={
            <a
              onClick={() => {
                // 有效证明要求来自活动配置，卡片状态来自今日接口，缺一不可
                void todayQuery.refetch()
                void campaignQuery.refetch()
              }}
            >
              {zh.common.retry}
            </a>
          }
        />
      </div>
    )
  }

  const campaign = campaignQuery.data.campaign
  const trackConfig = campaignQuery.data.tracks.find((item) => item.slug === track)
  const card = todayQuery.data.cards.find((item) => item.slug === track)

  if (!trackConfig) {
    return (
      <div className="page page--readable">
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
      <div className="page page--readable">
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
      <div className="page page--readable">
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

  /**
   * 提交前的即时校验。
   *
   * 与服务端 resolveDeclaration 一一对应，目的是让用户在点提交之前就知道差什么，
   * 而不是被服务端拒一次。**服务端仍然是权威**，这里只是把同一套规则提前说一遍。
   */
  const lenientImages = isLenientImageTrack(track)
  // 读书只要图片与备注有一个就算交齐材料，所以它不看 min_images
  const missingProof = lenientImages
    ? images.length === 0 && note.trim() === ''
    : images.length < rules.min_images
  const missingDeclaration = track === 'vocabulary'
    ? !(wordCount !== null && Number.isInteger(wordCount) && wordCount >= WORD_COUNT_MIN)
    : track === 'fitness'
      ? exerciseType === null
      : false
  const blocked = missingProof || missingDeclaration

  // 只显示一条提示：材料与申报明细可能同时缺，一次说一件事更容易照做
  let blockerHint: string | null = null
  if (missingProof) {
    blockerHint = lenientImages
      ? zh.checkin.submit.readingNeedsOne
      : zh.checkin.submit.minImages(rules.min_images)
  } else if (missingDeclaration) {
    if (track === 'vocabulary') {
      blockerHint = wordCount !== null && wordCount < WORD_COUNT_MIN
        ? zh.checkin.submit.wordCountTooFew(WORD_COUNT_MIN)
        : zh.checkin.submit.wordCountRequired
    } else {
      blockerHint = zh.checkin.submit.exerciseTypeRequired
    }
  }

  return (
    <div className="page page--readable">
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

      {/*
        申报明细紧跟在证明材料下面，且是**必填**（单词与运动）：
        它决定这条打卡值几分，所以不能等到审核员去猜（design.md §9.1）。
      */}
      {track === 'vocabulary' && (
        <Card size="small" title={zh.checkin.submit.wordCount} style={{ marginBottom: 16 }}>
          {/*
            下限刻意不设成 WORD_COUNT_MIN：antd 的 InputNumber 会在失焦时把值
            **静默夹到 min**，于是用户填 20 会看到它自己变成 30，然后以为交的是 20。
            改成一个只是挡掉零和负数的下限，让「不能少于 30 个」那句提示来说清楚 ——
            按钮禁用 + 明说原因，比悄悄改掉用户填的数字诚实。
          */}
          <InputNumber
            value={wordCount}
            onChange={setWordCount}
            min={1}
            precision={0}
            style={{ width: '100%' }}
            placeholder={zh.checkin.submit.wordCountPlaceholder}
            disabled={submitting}
            addonAfter="个"
          />
        </Card>
      )}

      {track === 'fitness' && (
        <Card size="small" title={zh.checkin.submit.exerciseType} style={{ marginBottom: 16 }}>
          <Radio.Group
            value={exerciseType}
            onChange={(event) => setExerciseType(event.target.value as string)}
            disabled={submitting}
          >
            <Space direction="vertical" size={4}>
              {FITNESS_EXERCISE_TYPES.map((code) => (
                <Radio key={code} value={code}>
                  {exerciseTypeLabel(code)}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Card>
      )}

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
        disabled={blocked}
        onClick={() => submit.mutate()}
      >
        {submit.isError ? zh.common.retrySubmit : zh.common.submit}
      </Button>

      {blockerHint && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 8 }}>
          {blockerHint}
        </Typography.Text>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 24 }}>
        {zh.checkin.submit.resubmittedNotice}
      </Typography.Paragraph>
    </div>
  )
}
