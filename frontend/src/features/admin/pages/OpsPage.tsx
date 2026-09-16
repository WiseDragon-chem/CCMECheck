import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import {
  Alert,
  App as AntdApp,
  Col,
  DatePicker,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from 'antd'
import { presentError } from '@/api/presentError'
import { invalidationMap, qk } from '@/api/queryKeys'
import type { AdminParticipant } from '@/api/types'
import { fromPickerDate, toPickerDate } from '@/lib/datetime'
import { parsePointsToMilli } from '@/lib/milli'
import { zh } from '@/locales/zh-CN'
import { fetchCampaignConfig } from '../api/misc'
import {
  createManualEntry,
  createScoreAdjustment,
  freezeLeaderboard,
  rebuildLeaderboard,
  reopenEntry,
  revokeEntry,
  unfreezeLeaderboard,
  voidEntry,
} from '../api/ops'
import OpsAction, { EntryPreview, Field } from '../components/OpsAction'
import ParticipantPicker from '../components/ParticipantPicker'
import { useEntryLookup } from '../hooks/useEntryLookup'

/**
 * 异常处理（design.md §8.5）—— 超级管理员专用。
 *
 * 这一屏的每一个动作都不可逆或者会改写计分，所以有三条纪律贯穿全页：
 *
 *   1. **后果写在确认框里，不是提示里。** 「撤销后该记录立即停止计分」
 *      必须在按下确认之前看到，而不是事后弹个 toast。
 *
 *   2. **原因必填。** 服务端在 schema 层就强制了，这里提前挡住，
 *      免得管理员填完一屏表单才被一次 400 打回来。
 *
 *   3. **不做乐观更新。** 这些请求可能因为权限新鲜度被拒（REAUTH_REQUIRED），
 *      也可能撞上状态冲突。先改界面再回滚，会让管理员以为操作成功了。
 *
 * 数据一律靠失效重取，不做本地补写 —— 异常操作的频率是每天几次，
 * 省下的那一次请求换不来任何东西，却换来一个可能与服务端不一致的界面。
 */

/** 总榜在契约里是固定哨兵值（见 ScoreAdjustmentSchema 的说明） */
const OVERALL = '__overall__'

export default function OpsPage() {
  const campaignQuery = useQuery({
    queryKey: qk.admin.campaign,
    queryFn: fetchCampaignConfig,
    staleTime: Infinity,
  })

  const tracks = campaignQuery.data?.tracks ?? []

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {zh.admin.ops.title}
        </Typography.Title>
        <Typography.Text type="secondary">{zh.admin.ops.subtitle}</Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ManualSection tracks={tracks} />
        </Col>
        <Col xs={24} xl={12}>
          <AdjustmentSection tracks={tracks} />
        </Col>
        <Col xs={24} xl={8}>
          <ReopenSection />
        </Col>
        <Col xs={24} xl={8}>
          <RevokeSection />
        </Col>
        <Col xs={24} xl={8}>
          <VoidSection />
        </Col>
      </Row>

      <LeaderboardSection />
    </Space>
  )
}

// ---------------------------------------------------------------------------
// 共用的请求封装
// ---------------------------------------------------------------------------

/**
 * 异常操作的统一收尾：提示 + 失效。
 *
 * 失效哪几个查询由 invalidationMap 集中决定（见 queryKeys 的说明），
 * 这里不逐处写 —— 补录与撤销都会把记录推回待审核队列，
 * 漏掉队列的失效会让审核页停在旧数据上而没有任何迹象。
 */
function useOpsMutation<TBody, TResult>(
  run: (body: TBody) => Promise<TResult>,
  successText: string | ((result: TResult) => string),
  invalidate: readonly (readonly unknown[])[] = invalidationMap.adminOps,
): UseMutationResult<TResult, unknown, TBody> {
  const { message } = AntdApp.useApp()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      message.success(typeof successText === 'function' ? successText(result) : successText)
      for (const key of invalidate) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (error) => message.error(presentError(error).text),
  })
}

/** 赛道下拉。调整积分时多一个「总榜」选项 */
function trackOptions(tracks: { id: string; name: string }[], withOverall = false) {
  const options = tracks.map((track) => ({ value: track.id, label: track.name }))
  return withOverall ? [...options, { value: OVERALL, label: zh.admin.ops.overall }] : options
}

// ---------------------------------------------------------------------------
// 补录
// ---------------------------------------------------------------------------

function ManualSection({ tracks }: { tracks: { id: string; name: string }[] }) {
  const [participant, setParticipant] = useState<AdminParticipant | null>(null)
  const [trackId, setTrackId] = useState<string | undefined>()
  const [activityDate, setActivityDate] = useState<string | undefined>()
  const [status, setStatus] = useState<'pending' | 'approved'>('pending')
  const [note, setNote] = useState('')

  const mutation = useOpsMutation(createManualEntry, zh.admin.ops.done.manual)

  const ready = Boolean(participant && trackId && activityDate)

  return (
    <OpsAction
      title={zh.admin.ops.manual}
      hint={zh.admin.ops.manualHint}
      consequence={zh.admin.ops.consequenceManual}
      confirmText={zh.admin.ops.submit}
      ready={ready}
      mutation={mutation}
      buildBody={(reason) => ({
        participant_id: participant!.id,
        track_id: trackId!,
        activity_date: activityDate!,
        status,
        reason,
        note: note.trim() || undefined,
      })}
      onDone={() => {
        setParticipant(null)
        setActivityDate(undefined)
        setNote('')
      }}
    >
      <Field label={zh.admin.ops.participant}>
        <ParticipantPicker value={participant} onChange={setParticipant} />
      </Field>
      <Field label={zh.admin.ops.track}>
        <Select
          style={{ width: '100%' }}
          value={trackId}
          onChange={setTrackId}
          options={trackOptions(tracks)}
          placeholder={zh.admin.ops.track}
        />
      </Field>
      <Field label={zh.admin.ops.activityDate}>
        <DatePicker
          style={{ width: '100%' }}
          value={toPickerDate(activityDate)}
          onChange={(value) => setActivityDate(fromPickerDate(value))}
        />
      </Field>
      <Field label={zh.admin.ops.status}>
        <Select
          style={{ width: '100%' }}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: zh.admin.ops.statusPending },
            { value: 'approved', label: zh.admin.ops.statusApproved },
          ]}
        />
      </Field>
      <Field label={zh.admin.ops.note}>
        <Input
          value={note}
          maxLength={2000}
          placeholder={zh.admin.ops.notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </OpsAction>
  )
}

// ---------------------------------------------------------------------------
// 积分调整
// ---------------------------------------------------------------------------

function AdjustmentSection({ tracks }: { tracks: { id: string; name: string }[] }) {
  const [participant, setParticipant] = useState<AdminParticipant | null>(null)
  const [trackId, setTrackId] = useState<string | undefined>()
  const [points, setPoints] = useState<number | null>(null)

  // 调整不会自动刷新已发布的榜单，所以这里不失效排行榜 —— 见 invalidationMap
  const mutation = useOpsMutation(
    createScoreAdjustment,
    zh.admin.ops.done.adjustment,
    invalidationMap.scoreAdjustment,
  )

  const milli = pointsToMilli(points)
  const ready = Boolean(participant && trackId && milli !== null)

  return (
    <OpsAction
      title={zh.admin.ops.adjustment}
      hint={zh.admin.ops.adjustmentHint}
      consequence={zh.admin.ops.consequenceAdjustment}
      confirmText={zh.admin.ops.submit}
      ready={ready}
      mutation={mutation}
      buildBody={(reason) => ({
        participant_id: participant!.id,
        track_id: trackId!,
        points_delta: milli as number,
        reason,
      })}
      onDone={() => {
        setParticipant(null)
        setPoints(null)
      }}
    >
      <Field label={zh.admin.ops.participant}>
        <ParticipantPicker value={participant} onChange={setParticipant} />
      </Field>
      <Field label={zh.admin.ops.track}>
        <Select
          style={{ width: '100%' }}
          value={trackId}
          onChange={setTrackId}
          options={trackOptions(tracks, true)}
          placeholder={zh.admin.ops.track}
        />
      </Field>
      <Field
        label={zh.admin.ops.points}
        hint={milli === null ? zh.admin.ops.pointsHint : zh.admin.ops.pointsMilli(milli)}
      >
        <InputNumber
          style={{ width: '100%' }}
          value={points}
          // 后端收的是整数毫点，这里按「分」输入，允许三位小数 ——
          // 填 0.5 就是 500 毫点，与设计文档里 1000 = 1 分 的口径一致
          step={0.5}
          precision={3}
          stringMode={false}
          placeholder="1 或 -0.5"
          onChange={(value) => setPoints(typeof value === 'number' ? value : null)}
        />
      </Field>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {zh.admin.ops.consequenceAdjustment}
      </Typography.Text>
    </OpsAction>
  )
}

// ---------------------------------------------------------------------------
// 三个按记录 ID 的操作
// ---------------------------------------------------------------------------

/**
 * 记录 ID 的输入。
 *
 * 没有做成下拉：管理端没有「列出某个参赛者的全部记录」的接口
 * （审核队列只含待审核的），而现编一个会让这一屏多一次全表查询。
 * 管理员从审核页复制 ID 过来是最短路径 —— 占位文案也这么说。
 *
 * 输入之后会去查这条记录，原因见 useEntryLookup：重开/撤销/作废都要
 * 回传 version，所以「输入 ID」这件事的真实含义是先把记录取回来。
 */
function EntryIdInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      value={value}
      allowClear
      placeholder={zh.admin.ops.entryIdPlaceholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function ReopenSection() {
  const [entryId, setEntryId] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)
  const lookup = useEntryLookup(entryId)

  const mutation = useOpsMutation(
    (body: { entryId: string; version: number; reason: string; reopen_minutes?: number }) =>
      reopenEntry(body.entryId, {
        version: body.version,
        reason: body.reason,
        reopen_minutes: body.reopen_minutes,
      }),
    zh.admin.ops.done.reopen,
  )

  return (
    <OpsAction
      title={zh.admin.ops.reopen}
      hint={zh.admin.ops.reopenHint}
      consequence={zh.admin.ops.consequenceReopen}
      confirmText={zh.admin.ops.submit}
      ready={lookup.detail !== null}
      mutation={mutation}
      buildBody={(reason) => ({
        entryId,
        // 版本号取自查询结果，提交时回传的就是管理员在看的那一版
        version: lookup.detail?.version ?? 0,
        reason,
        reopen_minutes: minutes ?? undefined,
      })}
      onDone={() => {
        setEntryId('')
        setMinutes(null)
      }}
    >
      <Field label={zh.admin.ops.entryId}>
        <EntryIdInput value={entryId} onChange={setEntryId} />
      </Field>
      <EntryPreview
        detail={lookup.detail}
        isLoading={lookup.isLoading}
        isError={lookup.isError}
        onRefresh={lookup.refresh}
      />
      <Field label={zh.admin.ops.reopenMinutes} hint={zh.admin.ops.reopenMinutesHint}>
        <InputNumber
          style={{ width: '100%' }}
          min={1}
          max={10080}
          value={minutes}
          placeholder="120"
          onChange={(value) => setMinutes(typeof value === 'number' ? value : null)}
        />
      </Field>
      {/*
        重开成功不等于「参赛者就能交了」：活动本身不可提交时服务端会带回
        campaign_submittable=false 与一句 warning。不显示它，管理员会以为
        重开没生效，然后再点一次。
      */}
      {mutation.data && !mutation.data.campaign_submittable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message={zh.admin.ops.done.reopen}
          description={mutation.data.warning}
        />
      )}
    </OpsAction>
  )
}

function RevokeSection() {
  const [entryId, setEntryId] = useState('')
  const lookup = useEntryLookup(entryId)

  const mutation = useOpsMutation(
    (body: { entryId: string; version: number; reason: string }) =>
      revokeEntry(body.entryId, { version: body.version, reason: body.reason }),
    zh.admin.ops.done.revoke,
  )

  /*
    撤销只对已通过的记录有效（服务端对其他状态返回 409）。
    这里提前把按钮关掉并说明原因 —— 让管理员点一次、等一个来回、
    再读一句报错，对同一个信息是更差的包装。
  */
  const wrongStatus = lookup.detail !== null && lookup.detail.status !== 'approved'

  return (
    <OpsAction
      title={zh.admin.ops.revoke}
      hint={zh.admin.ops.revokeHint}
      consequence={zh.admin.ops.consequenceRevoke}
      confirmText={zh.admin.ops.submit}
      danger
      ready={lookup.detail !== null && !wrongStatus}
      mutation={mutation}
      buildBody={(reason) => ({
        entryId,
        version: lookup.detail?.version ?? 0,
        reason,
      })}
      onDone={() => setEntryId('')}
    >
      <Field label={zh.admin.ops.entryId}>
        <EntryIdInput value={entryId} onChange={setEntryId} />
      </Field>
      <EntryPreview
        detail={lookup.detail}
        isLoading={lookup.isLoading}
        isError={lookup.isError}
        onRefresh={lookup.refresh}
        statusHint={wrongStatus ? zh.admin.ops.revokeNeedsApproved : undefined}
      />
    </OpsAction>
  )
}

function VoidSection() {
  const [entryId, setEntryId] = useState('')
  const lookup = useEntryLookup(entryId)

  const mutation = useOpsMutation(
    (body: { entryId: string; version: number; reason: string }) =>
      voidEntry(body.entryId, { version: body.version, reason: body.reason }),
    zh.admin.ops.done.void,
  )

  return (
    <OpsAction
      title={zh.admin.ops.void}
      hint={zh.admin.ops.voidHint}
      consequence={zh.admin.ops.consequenceVoid}
      confirmText={zh.admin.ops.submit}
      danger
      ready={lookup.detail !== null}
      mutation={mutation}
      buildBody={(reason) => ({
        entryId,
        version: lookup.detail?.version ?? 0,
        reason,
      })}
      onDone={() => setEntryId('')}
    >
      <Field label={zh.admin.ops.entryId}>
        <EntryIdInput value={entryId} onChange={setEntryId} />
      </Field>
      <EntryPreview
        detail={lookup.detail}
        isLoading={lookup.isLoading}
        isError={lookup.isError}
        onRefresh={lookup.refresh}
      />
    </OpsAction>
  )
}

// ---------------------------------------------------------------------------
// 排行榜维护（§8.5 的最后两项 + §14 的重算）
// ---------------------------------------------------------------------------

function LeaderboardSection() {
  const [cutoffDate, setCutoffDate] = useState<string | undefined>()

  const rebuild = useOpsMutation(
    (body: { reason: string; cutoff_date?: string }) => rebuildLeaderboard(body),
    (result) => zh.admin.ops.doneRebuild(result.row_count),
    invalidationMap.leaderboardMaintenance,
  )

  const freeze = useOpsMutation(
    (body: { reason: string; cutoff_date?: string }) => freezeLeaderboard(body),
    (result) => zh.admin.ops.doneFreeze(result.row_count),
    invalidationMap.leaderboardMaintenance,
  )

  const unfreeze = useOpsMutation(
    (body: { reason: string; cutoff_date: string }) => unfreezeLeaderboard(body),
    zh.admin.ops.doneUnfreeze,
    invalidationMap.leaderboardMaintenance,
  )

  return (
    <div>
      <Typography.Title level={5} style={{ marginBottom: 4 }}>
        {zh.admin.ops.leaderboard}
      </Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {zh.admin.ops.leaderboardHint}
      </Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
        <Col xs={24} xl={8}>
          <OpsAction
            title={zh.admin.ops.rebuild}
            hint={zh.admin.ops.rebuildHint}
            consequence={zh.admin.ops.consequenceRebuild}
            confirmText={zh.admin.ops.rebuild}
            ready
            mutation={rebuild}
            buildBody={(reason) => ({ reason, cutoff_date: cutoffDate })}
          >
            <CutoffField value={cutoffDate} onChange={setCutoffDate} />
          </OpsAction>
        </Col>

        <Col xs={24} xl={8}>
          <OpsAction
            title={zh.admin.ops.freeze}
            hint={zh.admin.ops.freezeHint}
            consequence={zh.admin.ops.consequenceFreeze}
            confirmText={zh.admin.ops.freeze}
            danger
            ready
            mutation={freeze}
            buildBody={(reason) => ({ reason, cutoff_date: cutoffDate })}
          >
            <CutoffField value={cutoffDate} onChange={setCutoffDate} />
          </OpsAction>
        </Col>

        <Col xs={24} xl={8}>
          <OpsAction
            title={zh.admin.ops.unfreeze}
            hint={zh.admin.ops.unfreezeHint}
            consequence={zh.admin.ops.consequenceUnfreeze}
            confirmText={zh.admin.ops.unfreeze}
            danger
            // 解冻必须指定日期：解冻哪一份不能靠猜（服务端的 schema 也是这么定的）
            ready={Boolean(cutoffDate)}
            mutation={unfreeze}
            buildBody={(reason) => ({ reason, cutoff_date: cutoffDate as string })}
          >
            <CutoffField value={cutoffDate} onChange={setCutoffDate} required />
          </OpsAction>
        </Col>
      </Row>
    </div>
  )
}

function CutoffField({
  value,
  onChange,
  required,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  required?: boolean
}) {
  return (
    <Field
      label={zh.admin.ops.cutoffDate}
      hint={required ? zh.admin.ops.cutoffDateRequired : zh.admin.ops.cutoffDateHint}
    >
      <DatePicker
        style={{ width: '100%' }}
        value={toPickerDate(value)}
        onChange={(next) => onChange(fromPickerDate(next))}
      />
    </Field>
  )
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 积分输入 → 整数毫点。空值或非法值返回 null，界面据此禁用提交 */
function pointsToMilli(points: number | null): number | null {
  if (points === null) return null
  if (!Number.isFinite(points)) return null
  try {
    return parsePointsToMilli(points)
  } catch {
    return null
  }
}
