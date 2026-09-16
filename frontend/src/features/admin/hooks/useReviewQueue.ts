import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { qk } from '@/api/queryKeys'
import type { ReviewProgress, ReviewQueueEntry } from '@/api/types'
import { fetchReviewQueue } from '../api/reviews'
import type { ReviewFilters } from '../components/QueueColumn'

/**
 * 待审核队列。
 *
 * 用无限查询而不是分页查询，是因为审核是**连续**动作：
 * 每决定一条就重取第一页会让光标跳回去，键盘流断在这里。
 * 队列只往后接，已加载的部分留在原处。
 *
 * 一个重要前提：调用方传进来的 `filters` 必须是稳定引用
 * （页面里用 useMemo 记住）。否则每次渲染都会生成一个新的查询键，
 * 队列会被无限重取 —— 这在不带记忆的写法下是很容易踩的坑。
 */
const PAGE_SIZE = 30

export interface ReviewQueueState {
  /** 服务端返回的全部条目（未扣除本次会话已决的那些） */
  entries: ReviewQueueEntry[]
  progress: ReviewProgress | undefined
  total: number
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => void
  hasMore: boolean
  fetchMore: () => void
}

export function useReviewQueue(filters: ReviewFilters): ReviewQueueState {
  const query = useInfiniteQuery({
    queryKey: qk.admin.reviewQueue(filters),
    queryFn: ({ pageParam }) =>
      fetchReviewQueue({ ...filters, page: pageParam, page_size: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      // 已加载条数按**服务端**的条目算，不是可见条数 ——
      // 已决记录在服务端仍占着位置，用可见数判断会少取一页
      const loaded = pages.reduce((sum, page) => sum + page.entries.length, 0)
      return loaded >= lastPage.total ? undefined : pages.length + 1
    },
  })

  const pages = query.data?.pages

  /**
   * 展平后的条目必须是**稳定引用**。
   *
   * `pages.flatMap()` 每次渲染都返回一个新数组，而调用方要拿它去做
   * 状态初始化与依赖数组 —— 一个每次都是新身份的空数组会让那些 effect
   * 每渲染一次就重跑一次。只有数据真的变了才换引用。
   */
  const entries = useMemo(() => pages?.flatMap((page) => page.entries) ?? [], [pages])

  return {
    entries,
    // progress 是整场活动的统计，不随筛选变化，取最后一页的即可
    progress: pages?.[pages.length - 1]?.progress,
    total: pages?.[pages.length - 1]?.total ?? 0,
    isLoading: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
    hasMore: query.hasNextPage,
    fetchMore: () => void query.fetchNextPage(),
  }
}
