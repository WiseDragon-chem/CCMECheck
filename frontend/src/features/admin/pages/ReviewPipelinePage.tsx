import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { App as AntdApp, Button, Empty, Result, Skeleton, Space, Typography } from 'antd'
import { isApiError } from '@/api/client'
import { presentError } from '@/api/presentError'
import { invalidationMap, qk } from '@/api/queryKeys'
import type { RejectReasonCode } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import { approveReview, fetchRejectReasons, fetchReviewDetail, rejectReview } from '../api/reviews'
import { fetchCampaignConfig } from '../api/misc'
import ConflictModal from '../components/ConflictModal'
import ContextColumn from '../components/ContextColumn'
import MaterialsColumn from '../components/MaterialsColumn'
import QueueColumn, { type ReviewFilters } from '../components/QueueColumn'
import RejectModal from '../components/RejectModal'
import { useHotkeys } from '../hooks/useHotkeys'
import { usePreloadEntry } from '../hooks/usePreloadEntry'
import { useReviewQueue } from '../hooks/useReviewQueue'
import {
  acceptRefreshedVersion,
  decideAndAdvance,
  focusEntry,
  initialSession,
  isDetailStale,
  moveCursor,
  shouldFetchMore,
  visibleEntries,
  type ReviewSession,
} from '../reviewSession'

/**
 * 流水线审核（design.md §8.2）—— 整个产品最复杂也最值钱的一屏。
 *
 * 三件事决定了这一屏的写法，其余都是从它们推出来的：
 *
 *   1. **键盘流不能断。** 所以「已决」记在本地会话里（见 reviewSession），
 *      每审一条不重取队列；队列只往后接页面，光标不跳。
 *
 *   2. **版本号必须在聚焦时冻结。** 提交审核读的是 `versionAtFocus`，不是详情里
 *      那个会被背景刷新改掉的 `version`。读错了就会出现「看着第 2 版、
 *      提交第 1 版的版本号」，服务端判成并发冲突，审核员的结论被丢掉。
 *
 *   3. **误按不能通过记录。** 弹窗打开、全屏看图时决策键必须停用。
 *      中文输入法下这条尤其致命：在驳回原因里打拼音，a / r / j / k
 *      正是最常见的字母。
 */
export default function ReviewPipelinePage() {
  const { entryId: routeEntryId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { message } = AntdApp.useApp()
  const queryClient = useQueryClient()

  // 筛选条件放在 URL 里：刷新页面、把链接发给同事都能回到同一批记录上
  const filterKey = searchParams.toString()
  const trackParam = searchParams.get('track')
  const dateParam = searchParams.get('date')
  const classParam = searchParams.get('class')

  // 依赖三个标量而不是 searchParams 对象：后者每次渲染都可能是新身份，
  // 会让查询键跟着变，队列就被无限重取
  const filters = useMemo<ReviewFilters>(
    () => ({
      track: trackParam ?? undefined,
      activity_date: dateParam ?? undefined,
      class_name: classParam ?? undefined,
    }),
    [trackParam, dateParam, classParam],
  )

  const setFilters = useCallback(
    (next: ReviewFilters) => {
      const params = new URLSearchParams()
      if (next.track) params.set('track', next.track)
      if (next.activity_date) params.set('date', next.activity_date)
      if (next.class_name) params.set('class', next.class_name)
      setSearchParams(params, { replace: true })
    },
    [setSearchParams],
  )

  const queue = useReviewQueue(filters)

  const campaignQuery = useQuery({
    queryKey: qk.admin.campaign,
    queryFn: fetchCampaignConfig,
    staleTime: Infinity,
  })

  /**
   * 会话状态**带着它属于哪一套筛选条件**一起存。
   *
   * 筛选变了就该重开会话：「已决」列表属于旧的队列，带着它去新队列会出现
   * 「这个人我刚审过」但其实没审的记录被藏起来；光标同理。
   *
   * 用「记着归属、不匹配就当没有」实现，而不是一个「filterKey 变了就
   * setSession(null)」的 effect —— 后者会多渲染一次，而那一帧仍然画着
   * 旧筛选下的队列和光标，用户能看见它闪一下。
   */
  const [stored, setStored] = useState<{ key: string; session: ReviewSession } | null>(null)

  const session: ReviewSession | null = useMemo(() => {
    if (stored?.key === filterKey) return stored.session
    if (queue.entries.length === 0) return null
    // 深链 /admin/review/:entryId 时从那一条开始
    return initialSession(queue.entries, routeEntryId)
    // entries 在 useReviewQueue 里已经按数据变化记忆过，引用是稳的
  }, [stored, filterKey, queue.entries, routeEntryId])

  /** 所有会话更新都带上当前的 key。只在事件处理与那一条同步 effect 里调用 */
  const updateSession = (change: (current: ReviewSession) => ReviewSession) => {
    setStored((previous) => {
      const base =
        previous?.key === filterKey
          ? previous.session
          : initialSession(queue.entries, routeEntryId)
      return { key: filterKey, session: change(base) }
    })
  }

  const [viewBusy, setViewBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReasonCode, setRejectReasonCode] = useState<RejectReasonCode | undefined>()
  const [rejectDetail, setRejectDetail] = useState('')
  const [conflictOpen, setConflictOpen] = useState(false)

  /**
   * 打开驳回面板。
   *
   * 清空选中与补充说明放在这个事件里，而不是「open 变 true」的 effect 里：
   * 上一条记录的驳回原因会先闪一帧，而审核员一按 R 就看到一个
   * 不属于当前记录的结论。
   */
  const openReject = () => {
    setRejectReasonCode(undefined)
    setRejectDetail('')
    setRejectOpen(true)
  }

  const visible = useMemo(
    () => (session ? visibleEntries(queue.entries, session.decided) : []),
    [queue.entries, session],
  )
  const visibleIds = useMemo(() => visible.map((entry) => entry.entry_id), [visible])
  const cursorId = session?.cursorId ?? null
  const cursorIndex = cursorId ? visibleIds.indexOf(cursorId) : -1

  const detailQuery = useQuery({
    queryKey: qk.admin.reviewDetail(cursorId ?? ''),
    queryFn: () => fetchReviewDetail(cursorId as string),
    enabled: Boolean(cursorId),
  })

  const detail = detailQuery.data
  const reasonQuery = useQuery({
    queryKey: qk.admin.rejectReasons,
    queryFn: fetchRejectReasons,
    // 原因码与文案都是随代码发布的，一次会话内不会变
    staleTime: Infinity,
  })

  /**
   * 光标落到某条时冻结它的版本号。这是 §8.2 并发控制的全部依据。
   *
   * 这是本页唯一一处把「异步到达的数据」写进 state，也是唯一一处
   * 关掉 set-state-in-effect 的地方 —— 因为这件事确实无法在渲染期算出来：
   * versionAtFocus 的定义是「光标落到这一条时它的版本」，是个**时间点**，
   * 而不是当前缓存里的值。后台重取会把它改掉，而这正是要防的事
   * （见 reviewSession 顶部那段说明）。
   *
   * 也不能挪进事件处理：按 J 的那一刻详情通常还没到（网络往返在后面），
   * 那时根本拿不到版本号。
   *
   * focusEntry 是幂等的 —— 已经冻结过的同一条会原样返回，所以这里
   * 因为依赖变化而重跑，不会把版本号一路推高。
   */
  useEffect(() => {
    if (!detail || !cursorId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上方说明：这是「记录某个时间点的值」，不是可推导的状态
    updateSession((current) => focusEntry(current, cursorId, detail.version))
    // updateSession 每次渲染都是新的，进依赖数组会让这条 effect 每帧都跑一遍
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, cursorId, filterKey])

  // 只看下一条。再往后预取是在浪费带宽 —— 审核员随时可能跳着审
  const nextId = cursorIndex >= 0 ? (visibleIds[cursorIndex + 1] ?? null) : null
  usePreloadEntry(nextId)

  /**
   * 光标越过了已加载页的末尾时接着取。
   *
   * 判断依据不是「还剩几条可见」，而是 shouldFetchMore 里那套：
   * 已决记录在服务端仍占着页码，按可见长度判断会在审完一批之后少取一页。
   */
  useEffect(() => {
    if (!session || queue.isFetching) return
    const needed = shouldFetchMore({
      cursorId: session.cursorId,
      loadedIds: visibleIds,
      loadedCount: queue.entries.length,
      total: queue.total,
    })
    if (needed && queue.hasMore) queue.fetchMore()
  }, [session, visibleIds, queue])

  const invalidate = () => {
    for (const key of invalidationMap.reviewDecide) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  /** 审核员确认过的版本。为空说明详情还没到，此时不该允许提交 */
  const frozenVersion = session?.versionAtFocus ?? null
  const canDecide = Boolean(cursorId) && frozenVersion !== null && !detailQuery.isError

  const conflictRefetch = useCallback(async () => {
    setConflictOpen(true)
    // 拉一次详情，好在对话框里告诉审核员「当前是第几版」
    await detailQuery.refetch()
  }, [detailQuery])

  /**
   * 提交时把 entryId 与版本号作为**参数**带进去，而不是从闭包里读。
   *
   * 请求发出去到回调执行之间光标可能已经移走了（慢网络下按 J 切下一条），
   * 闭包里的 cursorId 会变成新的那一条 —— 于是「通过」按钮的结论落到
   * 下一条记录上。参数跟着调用走，这类错配就不存在了。
   */
  const approveMutation = useMutation({
    mutationFn: (target: { entryId: string; version: number }) =>
      approveReview(target.entryId, { version: target.version }),
    onSuccess: (_result, target) => {
      message.success(zh.admin.review.approveSuccess)
      updateSession((current) => decideAndAdvance(current, target.entryId, visibleIds))
      invalidate()
    },
    onError: (error) => {
      // 冲突单独处理：自动重试等于用后来者的结论盖掉先审的人
      if (isApiError(error) && error.code === 'REVIEW_CONFLICT') void conflictRefetch()
      else message.error(presentError(error).text)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (params: {
      entryId: string
      version: number
      reasonCode: RejectReasonCode
      reason?: string
    }) =>
      rejectReview(params.entryId, {
        version: params.version,
        reason_code: params.reasonCode,
        reason: params.reason,
      }),
    onSuccess: (_result, params) => {
      message.success(zh.admin.review.rejectSuccess)
      setRejectOpen(false)
      updateSession((current) => decideAndAdvance(current, params.entryId, visibleIds))
      invalidate()
    },
    onError: (error) => {
      setRejectOpen(false)
      if (isApiError(error) && error.code === 'REVIEW_CONFLICT') void conflictRefetch()
      else message.error(presentError(error).text)
    },
  })

  /** 两个决策动作共用：目标与版本号都在这一刻定死 */
  const decideTarget = () =>
    cursorId && frozenVersion !== null ? { entryId: cursorId, version: frozenVersion } : null

  const approveCurrent = () => {
    const target = decideTarget()
    if (target) approveMutation.mutate(target)
  }

  // 不套 useCallback：useHotkeys 从 ref 里读最新的绑定，
  // 这里 memo 掉只会多出「依赖数组该写什么」这个问题，换不来任何东西
  const goTo = (delta: number) => {
    updateSession((current) => moveCursor(current, visibleIds, delta))
  }

  const modalOpen = rejectOpen || conflictOpen

  /**
   * 导航键。弹窗打开时停用 —— 否则在驳回原因里按 j 会切走记录，
   * 面板上的材料换了，正在填的原因也跟着对错了人。
   */
  useHotkeys(
    [
      { key: 'j', handler: () => goTo(1) },
      { key: 'k', handler: () => goTo(-1) },
    ],
    { enabled: !modalOpen },
  )

  /**
   * 决策键。全屏看图时也停用：那时整屏都是材料，按 a 通过一条
   * 还没看完的记录是这一屏最容易发生的事故。
   */
  useHotkeys(
    [
      { key: 'a', handler: () => canDecide && approveCurrent() },
      { key: 'r', handler: () => canDecide && openReject() },
    ],
    { enabled: !modalOpen && !viewBusy },
  )

  // 光标跟着 URL 走，刷新页面能回到同一条
  useEffect(() => {
    if (!cursorId) return
    navigate(paths.admin.reviewEntry(cursorId), { replace: true })
  }, [cursorId, navigate])

  if (queue.isError) {
    return (
      <Result
        status="warning"
        title={zh.admin.review.loadQueueFailed}
        subTitle={zh.common.loadFailed}
        extra={<Button onClick={queue.refetch}>{zh.common.retry}</Button>}
      />
    )
  }

  if (queue.isLoading) {
    return <Skeleton active paragraph={{ rows: 10 }} />
  }

  // 背景刷新把版本推高了：界面要提示，但不自动改冻结值（那正是冲突的来源）
  const detailStale = Boolean(session && detail && isDetailStale(session, detail.version))

  return (
    <div className="review-pipeline">
      <div className="review-pipeline__body">
        <QueueColumn
          tracks={campaignQuery.data?.tracks ?? []}
          filters={filters}
          onFiltersChange={setFilters}
          entries={visible}
          progress={queue.progress}
          cursorId={cursorId}
          onSelect={(entryId) =>
            // 点回当前这一条不该重置版本冻结值 —— focusEntry 已经处理了这种情况
            updateSession((current) => focusEntry(current, entryId, null))
          }
          isLoading={queue.isLoading}
          hasMore={queue.hasMore}
        />

        {!cursorId ? (
          <div className="review-pipeline__col review-pipeline__col--materials review-pipeline__empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={zh.admin.review.noSelection}
            />
          </div>
        ) : detailQuery.isError ? (
          <div className="review-pipeline__col review-pipeline__col--materials review-pipeline__empty">
            <Result
              status="warning"
              title={zh.admin.review.loadDetailFailed}
              subTitle={zh.common.loadFailed}
              extra={<Button onClick={() => void detailQuery.refetch()}>{zh.common.retry}</Button>}
            />
          </div>
        ) : (
          <MaterialsColumn
            entryId={cursorId}
            assets={detail?.current_revision?.assets ?? []}
            isManual={detail?.is_manual ?? false}
            onViewModeChange={setViewBusy}
            hotkeysEnabled={!modalOpen}
          />
        )}

        {detail ? (
          <ContextColumn
            detail={detail}
            isStale={detailStale}
            onAcceptRefreshed={() =>
              updateSession((current) => acceptRefreshedVersion(current, detail.version))
            }
          />
        ) : (
          <div className="review-pipeline__col review-pipeline__col--context">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        )}
      </div>

      <div className="review-pipeline__footer">
        <Space size={8}>
          <Button
            icon={<LeftOutlined />}
            disabled={cursorIndex <= 0}
            onClick={() => goTo(-1)}
          >
            {zh.admin.review.prev}
            <HotkeyHint>{zh.admin.review.hotkeyPrev}</HotkeyHint>
          </Button>
          <Button
            icon={<RightOutlined />}
            disabled={cursorIndex < 0 || cursorIndex >= visibleIds.length - 1}
            onClick={() => goTo(1)}
          >
            {zh.admin.review.next}
            <HotkeyHint>{zh.admin.review.hotkeyNext}</HotkeyHint>
          </Button>
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {cursorIndex >= 0 && zh.admin.review.position(cursorIndex + 1, visibleIds.length)} ·{' '}
          {zh.admin.review.shortcutHint}
        </Typography.Text>

        <Space size={8}>
          <Button
            danger
            icon={<CloseOutlined />}
            disabled={!canDecide}
            onClick={openReject}
          >
            {zh.admin.review.reject}
            <HotkeyHint>{zh.admin.review.hotkeyReject}</HotkeyHint>
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            disabled={!canDecide}
            loading={approveMutation.isPending}
            onClick={approveCurrent}
          >
            {zh.admin.review.approve}
            <HotkeyHint>{zh.admin.review.hotkeyApprove}</HotkeyHint>
          </Button>
        </Space>
      </div>

      <RejectModal
        open={rejectOpen}
        reasons={reasonQuery.data ?? []}
        loading={rejectMutation.isPending}
        reasonCode={rejectReasonCode}
        onReasonCodeChange={setRejectReasonCode}
        detail={rejectDetail}
        onDetailChange={setRejectDetail}
        onSubmit={() => {
          const target = decideTarget()
          if (!target || !rejectReasonCode) return
          rejectMutation.mutate({
            ...target,
            reasonCode: rejectReasonCode,
            reason: rejectDetail.trim() || undefined,
          })
        }}
        onCancel={() => setRejectOpen(false)}
      />

      <ConflictModal
        open={conflictOpen}
        currentVersion={detail?.version ?? null}
        loading={detailQuery.isFetching}
        onRefresh={() => {
          if (detail) {
            updateSession((current) => acceptRefreshedVersion(current, detail.version))
          }
          setConflictOpen(false)
        }}
        onSkip={() => {
          setConflictOpen(false)
          goTo(1)
        }}
      />
    </div>
  )
}

/** 按钮上的快捷键提示。做成一个小标签而不是括号文字，是为了不抢按钮文案 */
function HotkeyHint({ children }: { children: string }) {
  return <span className="hotkey-hint">{children}</span>
}
