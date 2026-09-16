import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { LeaderboardRow } from '@/api/types'
import { renderWithProviders } from '@/test/renderWithProviders'
import LeaderboardPage from './LeaderboardPage'

const API = 'http://localhost:3000/api/v1'

function row(overrides: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1,
    participant_id: 'p1',
    name: '张文博',
    class_name: '化学 1 班',
    valid_days: 4,
    score: 8.5,
    score_milli: 8500,
    reached_at: null,
    is_me: false,
    ...overrides,
  }
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function mockCampaign() {
  server.use(
    http.get(`${API}/campaigns/current`, () =>
      HttpResponse.json({
        campaign: {
          id: 'c1',
          name: '国庆打卡活动 2026',
          description: null,
          timezone: 'Asia/Shanghai',
          start_date: '2026-09-12',
          end_date: '2026-09-19',
          daily_open_time: '00:00',
          daily_deadline: '23:59',
          status: 'active',
          leaderboard_visible: true,
          leaderboard_time: '06:00',
          name_display_mode: 'real',
          tie_break_rule: 'score_desc_valid_days_desc_reached_at_asc',
          upload_rules: {
            min_images: 1,
            max_images: 3,
            max_image_bytes: 10485760,
            allowed_mime_types: ['image/jpeg'],
          },
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        tracks: [
          {
            id: 't1',
            slug: 'reading',
            name: '读书',
            description: null,
            icon: 'book',
            proof_instructions: null,
            enabled: true,
            daily_points: 1000,
            daily_cap: null,
            campaign_cap: null,
            overall_weight: 1000,
          },
          {
            id: 't2',
            slug: 'fitness',
            name: '运动健身',
            description: null,
            icon: 'run',
            proof_instructions: null,
            // 停用的赛道不应出现在标签页里
            enabled: false,
            daily_points: 1000,
            daily_cap: null,
            campaign_cap: null,
            overall_weight: 1000,
          },
        ],
        server_time: new Date().toISOString(),
        activity_date: '2026-09-16',
        server_time_of_day: '21:00',
      }),
    ),
  )
}

function mockLeaderboard(payload: Partial<Record<string, unknown>>) {
  server.use(
    http.get(`${API}/leaderboards/latest`, () =>
      HttpResponse.json({
        snapshot: {
          id: 's1',
          cutoff_date: '2026-09-15',
          generated_at: '2026-09-15T22:00:00.000Z',
          is_final: false,
          status: 'ready',
        },
        track: { slug: '__overall__', name: '总榜' },
        counted_through: '2026-09-15',
        rows: [],
        total: 0,
        me: null,
        ...payload,
      }),
    ),
  )
}

describe('排行榜', () => {
  it('标签页来自活动配置的启用赛道，再加总榜', async () => {
    mockCampaign()
    mockLeaderboard({})

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByRole('tab', { name: '读书' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '总榜' })).toBeInTheDocument()
    // 停用的赛道不该出现
    expect(screen.queryByRole('tab', { name: '运动健身' })).not.toBeInTheDocument()
  })

  it('展示名次、姓名、班级、有效天数与积分', async () => {
    mockCampaign()
    mockLeaderboard({
      rows: [
        row({ rank: 1, participant_id: 'a', name: '张文博', class_name: '化学 1 班', valid_days: 4, score: 8.5 }),
        row({ rank: 2, participant_id: 'b', name: '李思远', class_name: '化学 2 班', valid_days: 3, score: 7 }),
      ],
      total: 2,
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText('张文博')).toBeInTheDocument()
    expect(screen.getByText(/化学 1 班 · 有效 4 天/)).toBeInTheDocument()
    expect(screen.getByText('8.5')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('并列名次原样展示，不按列表下标重新编号', async () => {
    mockCampaign()
    // 同分并列是 §9.3 的预期行为：1, 1, 3
    mockLeaderboard({
      rows: [
        row({ rank: 1, participant_id: 'a', name: '甲' }),
        row({ rank: 1, participant_id: 'b', name: '乙' }),
        row({ rank: 3, participant_id: 'c', name: '丙' }),
      ],
      total: 3,
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    await screen.findByText('甲')
    const ranks = document.querySelectorAll('.lb-row__rank')
    expect([...ranks].map((el) => el.textContent)).toEqual(['1', '1', '3'])
  })

  it('高亮当前用户所在行，并带上「我」标记', async () => {
    mockCampaign()
    mockLeaderboard({
      rows: [
        row({ rank: 1, participant_id: 'a', name: '张文博' }),
        row({ rank: 2, participant_id: 'me', name: '李思远', is_me: true }),
      ],
      total: 2,
      me: { row: row({ rank: 2, participant_id: 'me', name: '李思远', is_me: true }), window: [] },
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    await screen.findByText('李思远')
    // 不能只靠颜色区分 —— 必须还有一个文字标记
    expect(screen.getByText('我')).toBeInTheDocument()

    const meRow = document.querySelector('.lb-row.is-me')
    expect(meRow).toBeTruthy()
    expect(meRow?.textContent).toContain('李思远')
  })

  it('自己不在已加载范围内时，底部固定显示我的名次', async () => {
    mockCampaign()
    mockLeaderboard({
      rows: [row({ rank: 1, participant_id: 'a', name: '张文博' })],
      total: 200,
      me: { row: row({ rank: 137, participant_id: 'me', name: '李思远', is_me: true }), window: [] },
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    await screen.findByText('张文博')
    const bar = document.querySelector('.my-rank-bar')
    expect(bar).toBeTruthy()
    expect(bar?.textContent).toContain('137')
    expect(bar?.textContent).toContain('李思远')
  })

  it('自己在列表里时不重复显示底部固定行', async () => {
    mockCampaign()
    mockLeaderboard({
      rows: [row({ rank: 1, participant_id: 'me', name: '李思远', is_me: true })],
      total: 1,
      me: { row: row({ rank: 1, participant_id: 'me', name: '李思远', is_me: true }), window: [] },
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    await screen.findByText('李思远')
    expect(document.querySelector('.my-rank-bar')).toBeNull()
  })

  it('还没有快照时给出明确空状态，而不是一张空表', async () => {
    mockCampaign()
    mockLeaderboard({ snapshot: null, counted_through: null, rows: [], total: 0 })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText(/排行榜尚未生成/)).toBeInTheDocument()
  })

  it('快照生成失败时提示当前显示的是上一份数据', async () => {
    mockCampaign()
    mockLeaderboard({
      snapshot: {
        id: 's1',
        cutoff_date: '2026-09-15',
        generated_at: '2026-09-15T22:00:00.000Z',
        is_final: false,
        status: 'failed',
      },
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText(/当前显示的仍是上一份有效数据/)).toBeInTheDocument()
  })

  it('展示更新节奏 —— 挡掉「刚通过为什么榜上没变」这类疑问', async () => {
    mockCampaign()
    mockLeaderboard({})

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText(/每日 06:00 更新/)).toBeInTheDocument()
  })

  it('展示统计截止日与快照生成时间', async () => {
    mockCampaign()
    mockLeaderboard({})

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText(/统计至 2026-09-15/)).toBeInTheDocument()
  })

  it('最终榜单打上标识', async () => {
    mockCampaign()
    mockLeaderboard({
      snapshot: {
        id: 's1',
        cutoff_date: '2026-09-19',
        generated_at: '2026-09-19T22:00:00.000Z',
        is_final: true,
        status: 'ready',
      },
    })

    renderWithProviders(<LeaderboardPage />, { route: '/leaderboard' })

    expect(await screen.findByText('最终榜单')).toBeInTheDocument()
  })
})
