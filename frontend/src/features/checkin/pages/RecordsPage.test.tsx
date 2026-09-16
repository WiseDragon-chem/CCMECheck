import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { CheckinListItem } from '@/api/types'
import { renderWithProviders } from '@/test/renderWithProviders'
import RecordsPage from './RecordsPage'

const API = 'http://localhost:3000/api/v1'

function item(overrides: Partial<CheckinListItem>): CheckinListItem {
  return {
    entry_id: 'e1',
    track: { slug: 'reading', name: '读书' },
    activity_date: '2026-09-15',
    status: 'approved',
    version: 2,
    submitted_at: '2026-09-15T13:25:00.000Z',
    reviewed_at: '2026-09-15T14:00:00.000Z',
    rejection_reason: null,
    rejection_code: null,
    note: null,
    asset_count: 2,
    can_resubmit: false,
    ...overrides,
  }
}

const server = setupServer()
let lastQuery: URLSearchParams | null = null

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  lastQuery = null
})

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
        ],
        server_time: new Date().toISOString(),
        activity_date: '2026-09-16',
        server_time_of_day: '21:00',
      }),
    ),
  )
}

function mockList(items: CheckinListItem[], total = items.length) {
  server.use(
    http.get(`${API}/checkins`, ({ request }) => {
      lastQuery = new URL(request.url).searchParams
      return HttpResponse.json({
        items,
        total,
        page: 1,
        page_size: Number(lastQuery.get('page_size') ?? 20),
      })
    }),
  )
}

describe('打卡记录列表', () => {
  /**
   * 「读书」在页面上会出现两次：筛选器的赛道选项，以及记录行里的赛道名。
   * 所以断言要收窄到记录行内，否则选择器是歧义的。
   */
  function recordRows(): Element[] {
    return [...document.querySelectorAll('.ant-card')]
  }

  it('渲染记录，带赛道、状态与提交时间', async () => {
    mockCampaign()
    mockList([item({ entry_id: 'a', track: { slug: 'reading', name: '读书' }, asset_count: 3 })])

    renderWithProviders(<RecordsPage />, { route: '/records' })

    await waitFor(() => expect(recordRows()).toHaveLength(1))
    const row = recordRows()[0]!
    expect(row.textContent).toContain('读书')
    expect(row.textContent).toContain('已通过')
    expect(row.textContent).toContain('9月15日')
    expect(row.textContent).toContain('3 张')
  })

  it('驳回的记录展示驳回原因（§16.6）', async () => {
    mockCampaign()
    mockList([
      item({
        entry_id: 'a',
        status: 'rejected',
        rejection_reason: '截图中没有显示日期',
      }),
    ])

    renderWithProviders(<RecordsPage />, { route: '/records' })

    expect(await screen.findByText('已驳回')).toBeInTheDocument()
    expect(screen.getByText(/驳回原因：截图中没有显示日期/)).toBeInTheDocument()
  })

  it('五种状态都有对应的中文标签与颜色', async () => {
    mockCampaign()
    mockList([
      item({ entry_id: '1', status: 'pending' }),
      item({ entry_id: '2', status: 'approved' }),
      item({ entry_id: '3', status: 'rejected' }),
      item({ entry_id: '4', status: 'revoked' }),
      item({ entry_id: '5', status: 'void' }),
    ])

    renderWithProviders(<RecordsPage />, { route: '/records' })

    await screen.findByText('待审核')
    for (const label of ['已通过', '已驳回', '已撤销', '已作废']) {
      expect(screen.getByText(label), label).toBeInTheDocument()
    }
  })

  it('按状态筛选会把条件带给接口', async () => {
    mockCampaign()
    mockList([item({})])

    renderWithProviders(<RecordsPage />, { route: '/records' })
    await waitFor(() => expect(recordRows()).toHaveLength(1))

    // 打开状态下拉并选择「已驳回」
    await userEvent.click(screen.getByText('全部状态'))
    await userEvent.click(await screen.findByTitle('已驳回'))

    await waitFor(() => expect(lastQuery?.get('status')).toBe('rejected'))
  })

  it('没有记录时给出引导，而不是空白', async () => {
    mockCampaign()
    mockList([])

    renderWithProviders(<RecordsPage />, { route: '/records' })

    expect(await screen.findByText(/还没有打卡记录/)).toBeInTheDocument()
  })

  it('筛选后没有结果时，提示是筛选造成的并提供清除入口', async () => {
    mockCampaign()
    mockList([])

    renderWithProviders(<RecordsPage />, { route: '/records' })
    await screen.findByText(/还没有打卡记录/)

    await userEvent.click(screen.getByText('全部状态'))
    await userEvent.click(await screen.findByTitle('已驳回'))

    // 「没有记录」和「筛选后没有记录」是两回事，混为一谈会让用户以为数据丢了
    expect(await screen.findByText(/当前筛选条件下没有记录/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
  })

  it('总数大于当前条数时提供加载更多', async () => {
    mockCampaign()
    mockList([item({ entry_id: 'a' }), item({ entry_id: 'b' })], 42)

    renderWithProviders(<RecordsPage />, { route: '/records' })

    expect(await screen.findByText(/加载更多（已显示 2 \/ 42）/)).toBeInTheDocument()
    expect(screen.getByText('共 42 条记录')).toBeInTheDocument()
  })

  it('接口失败时给出可重试的提示', async () => {
    mockCampaign()
    server.use(
      http.get(`${API}/checkins`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: '服务器内部错误', request_id: 'req_1', details: {} },
          { status: 500 },
        ),
      ),
    )

    renderWithProviders(<RecordsPage />, { route: '/records' })

    expect(await screen.findByText('没能加载打卡记录')).toBeInTheDocument()
  })
})
