import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiError } from '@/api/client'
import LoadError from './LoadError'

/**
 * 这一组守的是「副标题说的是真原因」。
 *
 * 曾经的写法把所有失败都写成「请检查网络后重试。」，
 * 于是「没有进行中的活动」这种必然失败的状态被说成网络问题，
 * 用户重试到怀疑人生也修不好。
 */

describe('LoadError', () => {
  it('没有进行中的活动是独立状态，不冒充网络故障', () => {
    render(
      <LoadError
        error={new ApiError({ code: 'CAMPAIGN_NOT_ACTIVE', status: 409, message: '当前没有进行中的活动' })}
        title="没能加载今日打卡"
      />,
    )

    expect(screen.getByText('当前没有进行中的活动')).toBeInTheDocument()
    expect(screen.queryByText('没能加载今日打卡')).not.toBeInTheDocument()
    expect(screen.queryByText('请检查网络后重试。')).not.toBeInTheDocument()
  })

  it('服务端有响应时用它的错误文案，不用网络文案', () => {
    render(
      <LoadError
        error={new ApiError({ code: 'NOT_FOUND', status: 404, message: '打卡记录不存在' })}
        title="没能加载记录详情"
      />,
    )

    expect(screen.getByText('没能加载记录详情')).toBeInTheDocument()
    expect(screen.getByText('内容不存在或已被删除')).toBeInTheDocument()
    expect(screen.queryByText('请检查网络后重试。')).not.toBeInTheDocument()
  })

  it('服务端 500 带上追踪号，供用户反馈时报给管理员', () => {
    render(
      <LoadError
        error={
          new ApiError({
            code: 'INTERNAL_ERROR',
            status: 500,
            message: '服务器内部错误',
            requestId: 'req_1',
          })
        }
        title="没能加载今日打卡"
      />,
    )

    expect(screen.getByText(/服务器出错了/)).toBeInTheDocument()
    expect(screen.getByText(/追踪号 req_1/)).toBeInTheDocument()
  })

  it('真的没连上服务端时才说检查网络', () => {
    render(<LoadError error={new TypeError('Failed to fetch')} title="没能加载今日打卡" />)

    expect(screen.getByText('没能加载今日打卡')).toBeInTheDocument()
    expect(screen.getByText('请检查网络后重试。')).toBeInTheDocument()
  })
})
