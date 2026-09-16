import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { CheckinDetail } from '@/api/types'
import { Route, Routes } from 'react-router'
import { renderWithProviders } from '@/test/renderWithProviders'
import RecordDetailPage from './RecordDetailPage'

const API = 'http://localhost:3000/api/v1'

function detail(overrides: Partial<CheckinDetail> = {}): CheckinDetail {
  return {
    entry_id: 'e1',
    track: { slug: 'reading', name: '读书', proof_instructions: '请上传包含阅读书名的截图。' },
    activity_date: '2026-09-15',
    status: 'pending',
    version: 2,
    submitted_at: '2026-09-15T13:25:00.000Z',
    reviewed_at: null,
    rejection_reason: null,
    rejection_code: null,
    reopen_expires_at: null,
    current_revision: {
      revision_number: 2,
      note: '今天的读书打卡',
      submitted_at: '2026-09-15T13:25:00.000Z',
      assets: [
        { asset_id: 'a1', width: 400, height: 300, mime_type: 'image/jpeg', size: 1024 },
        { asset_id: 'a2', width: 300, height: 400, mime_type: 'image/jpeg', size: 2048 },
      ],
    },
    history: [],
    ...overrides,
  }
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function mockDetail(payload: CheckinDetail) {
  server.use(http.get(`${API}/checkins/e1`, () => HttpResponse.json(payload)))
  // 每个素材单独签发一次地址
  server.use(
    http.get(`${API}/checkins/e1/assets/:assetId`, ({ params }) =>
      HttpResponse.json({
        url: `http://localhost:3000/api/v1/assets/${params.assetId}?exp=1&uid=u1&sig=test`,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        expires_in: 600,
      }),
    ),
  )
}

/**
 * 这个页面靠 useParams 取 entryId，所以必须在真实路由下渲染 ——
 * 直接渲染组件的话参数是空的，查询会永远停在 pending，
 * 而失败现场看起来只是「页面没有内容」，很难看出原因。
 */
function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/records/:entryId" element={<RecordDetailPage />} />
    </Routes>,
    { route: '/records/e1' },
  )
}

describe('记录详情', () => {
  it('展示赛道、状态、活动日与提交时间', async () => {
    mockDetail(detail())

    renderDetail()

    expect(await screen.findByText('读书')).toBeInTheDocument()
    expect(screen.getByText('待审核')).toBeInTheDocument()
    expect(screen.getByText('2026年9月15日')).toBeInTheDocument()
    // 时间戳按北京时间展示（13:25Z → 21:25）
    expect(screen.getByText('2026-09-15 21:25')).toBeInTheDocument()
  })

  it('展示该赛道的证明要求', async () => {
    mockDetail(detail())

    renderDetail()

    // 被驳回后回看时，用户最需要的就是「到底要求什么样的截图」
    expect(await screen.findByText('有效证明要求')).toBeInTheDocument()
    expect(screen.getByText('请上传包含阅读书名的截图。')).toBeInTheDocument()
  })

  it('驳回时把原因原样展示', async () => {
    mockDetail(
      detail({
        status: 'rejected',
        rejection_reason: '截图中没有显示日期',
        reviewed_at: '2026-09-15T15:00:00.000Z',
      }),
    )

    renderDetail()

    expect(await screen.findByText('本条记录被驳回')).toBeInTheDocument()
    expect(screen.getByText('截图中没有显示日期')).toBeInTheDocument()
    expect(screen.getByText('2026-09-15 23:00')).toBeInTheDocument()
  })

  it('被撤销与被作废各有专门的说明，而不是笼统的「无效」', async () => {
    mockDetail(detail({ status: 'revoked' }))
    renderDetail()
    expect(await screen.findByText('审核结果已被管理员撤销')).toBeInTheDocument()
  })

  it('管理员重开时提示时限', async () => {
    mockDetail(detail({ reopen_expires_at: '2026-09-16T06:00:00.000Z' }))

    renderDetail()

    expect(await screen.findByText('管理员已临时重新开放')).toBeInTheDocument()
    expect(screen.getByText(/2026-09-16 14:00/)).toBeInTheDocument()
  })

  it('为每张证明材料单独签发地址', async () => {
    mockDetail(detail())

    renderDetail()
    await screen.findByText('读书')

    // 两个素材最终应渲染出两张图（签名是异步的）
    const images = await screen.findAllByRole('img', {}, { timeout: 3000 })
    expect(images.length).toBeGreaterThanOrEqual(2)
  })

  it('历史版本默认折叠，展开后能看到较早的版本', async () => {
    mockDetail(
      detail({
        history: [
          { revision_number: 1, note: '第一次提交', submitted_at: '2026-09-15T10:00:00.000Z', asset_count: 1 },
        ],
      }),
    )

    renderDetail()

    const toggle = await screen.findByText(/提交历史（1 个较早版本）/)
    // 折叠状态下看不到内容
    expect(screen.queryByText(/第 1 版/)).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(await screen.findByText(/第 1 版/)).toBeInTheDocument()
    expect(screen.getByText(/第一次提交/)).toBeInTheDocument()
  })

  it('没有历史版本时不显示折叠面板', async () => {
    mockDetail(detail({ history: [] }))

    renderDetail()
    await screen.findByText('读书')

    expect(screen.queryByText(/提交历史/)).not.toBeInTheDocument()
  })

  it('接口失败时给出返回列表的出口', async () => {
    server.use(
      http.get(`${API}/checkins/e1`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '打卡记录不存在', request_id: 'req_1', details: {} },
          { status: 404 },
        ),
      ),
    )

    renderDetail()

    expect(await screen.findByText('没能加载记录详情')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回记录列表' })).toBeInTheDocument()
  })
})
