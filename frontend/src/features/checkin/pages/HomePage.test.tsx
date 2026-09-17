import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { TodayCard, TodayOverview } from '@/api/types'
import { renderWithProviders } from '@/test/renderWithProviders'
import HomePage from './HomePage'

/**
 * 主页面的渲染验证。
 *
 * 这里不测样式，只测「数据对不对得上前端要展示的东西」：
 * 三张卡片都出来了、状态文案正确、驳回原因被展示、
 * 以及活动停止提交时不会给出可点的按钮。
 *
 * 这几条正是参赛者每天要看的信息，错了会直接影响他们打不打卡。
 */

const API = 'http://localhost:3000/api/v1'

function makeCard(overrides: Partial<TodayCard>): TodayCard {
  return {
    track_id: 'tid',
    slug: 'reading',
    name: '读书',
    icon: 'book',
    proof_instructions: '请上传包含书名的截图',
    card_state: 'can_submit',
    can_submit: true,
    entry_id: null,
    status: null,
    rejection_reason: null,
    rejection_code: null,
    submitted_at: null,
    reviewed_at: null,
    reopen_expires_at: null,
    valid_days: 0,
    track_score: 0,
    daily_points: 1000,
    daily_cap: null,
    campaign_cap: null,
    overall_weight: 1000,
    ...overrides,
  }
}

const campaignStatus = { value: 'active' }

function todayPayload(cards: TodayCard[]): TodayOverview {
  return {
    is_participant: true,
    participant_id: 'p1',
    campaign: {
      id: 'c1',
      name: '国庆打卡活动 2026',
      status: campaignStatus.value,
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      daily_open_time: '00:00',
      daily_deadline: '23:59',
    },
    activity_date: '2026-10-01',
    server_time: new Date().toISOString(),
    seconds_to_deadline: 3 * 3600,
    total_valid_days: 2,
    total_score: 2000,
    cards,
  }
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

beforeEach(() => {
  campaignStatus.value = 'active'

  server.use(
    http.get(`${API}/campaigns/current`, () =>
      HttpResponse.json({
        campaign: {
          id: 'c1',
          name: '国庆打卡活动 2026',
          description: null,
          timezone: 'Asia/Shanghai',
          start_date: '2026-10-01',
          end_date: '2026-10-07',
          daily_open_time: '00:00',
          daily_deadline: '23:59',
          status: campaignStatus.value,
          leaderboard_visible: true,
          leaderboard_time: '06:00',
          name_display_mode: 'real',
          tie_break_rule: 'score_desc_valid_days_desc_reached_at_asc',
          upload_rules: {
            min_images: 1,
            max_images: 3,
            max_image_bytes: 10485760,
            allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
          },
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        tracks: [],
        server_time: new Date().toISOString(),
        activity_date: '2026-10-01',
        server_time_of_day: '21:00',
      }),
    ),
  )
})

function mockToday(cards: TodayCard[]) {
  server.use(http.get(`${API}/checkins/today`, () => HttpResponse.json(todayPayload(cards))))
}

describe('主页面', () => {
  it('渲染三张赛道卡片与各自的状态文案', async () => {
    mockToday([
      makeCard({ slug: 'reading', name: '读书', card_state: 'can_submit', can_submit: true }),
      makeCard({ slug: 'vocabulary', name: '单词背诵', card_state: 'pending', can_submit: true }),
      makeCard({ slug: 'fitness', name: '运动健身', card_state: 'approved', can_submit: false }),
    ])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('读书')).toBeInTheDocument()
    expect(screen.getByText('单词背诵')).toBeInTheDocument()
    expect(screen.getByText('运动健身')).toBeInTheDocument()

    // 状态文案是 §7.3 要求的三条通道之一，必须真的渲染出来
    expect(screen.getByText('今日尚未打卡')).toBeInTheDocument()
    expect(screen.getByText('已提交，等待审核')).toBeInTheDocument()
    expect(screen.getByText('今日打卡有效')).toBeInTheDocument()
  })

  it('显示活动名、活动日与累计有效天数', async () => {
    mockToday([makeCard({})])
    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('国庆打卡活动 2026')).toBeInTheDocument()
    // 活动日 2026-10-01 是周四
    expect(screen.getByText(/10月1日/)).toBeInTheDocument()
    expect(screen.getByText(/累计有效 2 天/)).toBeInTheDocument()
  })

  it('把驳回原因原样展示给参赛者（§16.6）', async () => {
    mockToday([
      makeCard({
        slug: 'reading',
        name: '读书',
        card_state: 'rejected',
        can_submit: true,
        rejection_reason: '截图中没有显示日期',
      }),
    ])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText(/驳回原因：截图中没有显示日期/)).toBeInTheDocument()
    // 未截止时给重新提交的入口
    expect(screen.getByRole('button', { name: '重新提交' })).toBeInTheDocument()
  })

  it('已截止的驳回不给重新提交按钮', async () => {
    mockToday([
      makeCard({
        slug: 'reading',
        name: '读书',
        card_state: 'rejected',
        can_submit: false,
        rejection_reason: '证明材料不完整',
      }),
    ])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('今日打卡无效（已截止）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新提交' })).not.toBeInTheDocument()
  })

  it('活动停止提交时给出说明且不提供打卡按钮', async () => {
    campaignStatus.value = 'settling'
    mockToday([makeCard({ slug: 'reading', name: '读书', card_state: 'can_submit', can_submit: false })])

    renderWithProviders(<HomePage />, { route: '/home' })

    // 横幅说明原因，卡片说明状态 —— 两者都要有，
    // 否则用户只看到一堆不可操作的卡片而不知道发生了什么
    expect(await screen.findByText(/活动已进入结算阶段/)).toBeInTheDocument()
    expect(screen.getByText('活动已停止提交')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '去打卡' })).not.toBeInTheDocument()
  })

  it('可提交时给出「去打卡」按钮', async () => {
    mockToday([makeCard({ slug: 'reading', name: '读书', card_state: 'can_submit', can_submit: true })])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByRole('button', { name: '去打卡' })).toBeInTheDocument()
  })

  it('待审核在截止前给「重新提交」，而不是「查看详情」', async () => {
    // §7.3 的状态表里，待审核一行的可用操作是「截止前可重新提交」。
    // 展示文案相同、操作不同，容易写成静态的「查看详情」。
    mockToday([
      makeCard({ slug: 'reading', name: '读书', card_state: 'pending', can_submit: true }),
    ])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('已提交，等待审核')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新提交' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看详情' })).not.toBeInTheDocument()
  })

  it('待审核但已截止时只能「查看详情」', async () => {
    mockToday([
      makeCard({ slug: 'reading', name: '读书', card_state: 'pending', can_submit: false }),
    ])

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('已提交，等待审核')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新提交' })).not.toBeInTheDocument()
  })

  it('非参赛者看到的是独立的空状态，不是错误也不是空列表', async () => {
    server.use(
      http.get(`${API}/checkins/today`, () =>
        HttpResponse.json({ ...todayPayload([]), is_participant: false, cards: [] }),
      ),
    )

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText(/当前账号不是本次活动的参赛者/)).toBeInTheDocument()
  })

  it('排行榜更新节奏的说明会展示出来', async () => {
    mockToday([makeCard({})])
    renderWithProviders(<HomePage />, { route: '/home' })

    // 这条文案挡掉「我刚通过为什么榜上没变」这类高频疑问
    expect(await screen.findByText(/排行榜每日 06:00 更新/)).toBeInTheDocument()
  })

  it('接口失败时给出可重试的提示，而不是白屏', async () => {
    server.use(
      http.get(`${API}/checkins/today`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: '服务器内部错误', request_id: 'req_1', details: {} },
          { status: 500 },
        ),
      ),
    )

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('没能加载今日打卡')).toBeInTheDocument()
    // 服务端已经说了原因，就不该再用「检查网络」把它盖掉
    expect(await screen.findByText(/服务器出错了/)).toBeInTheDocument()
    expect(screen.queryByText('请检查网络后重试。')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('重新加载')).toBeInTheDocument())
  })

  /**
   * 回归：活动未发布/已归档时，两个接口都会返回 409 CAMPAIGN_NOT_ACTIVE，
   * 界面曾经统一显示「没能加载今日打卡 · 请检查网络后重试。」——
   * 用户按提示检查网络、反复重试都不可能成功，真正的原因（没有进行中的活动）
   * 反而没告诉任何人。
   */
  it('没有进行中的活动时说清楚，而不是让用户去检查网络', async () => {
    const noCampaign = () =>
      HttpResponse.json(
        { code: 'CAMPAIGN_NOT_ACTIVE', message: '当前没有进行中的活动', request_id: 'req_9', details: {} },
        { status: 409 },
      )
    server.use(
      http.get(`${API}/campaigns/current`, noCampaign),
      http.get(`${API}/checkins/today`, noCampaign),
    )

    renderWithProviders(<HomePage />, { route: '/home' })

    expect(await screen.findByText('当前没有进行中的活动')).toBeInTheDocument()
    expect(screen.getByText(/发布新活动后重新加载本页即可/)).toBeInTheDocument()
    expect(screen.queryByText('请检查网络后重试。')).not.toBeInTheDocument()
  })
})
