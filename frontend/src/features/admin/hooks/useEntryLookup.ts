import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/api/queryKeys'
import type { ReviewEntryDetail } from '@/api/types'
import { fetchReviewDetail } from '../api/reviews'

/**
 * 按记录 ID 查一条记录（§8.5 的重开/撤销/作废都要）。
 *
 * 这三个接口都必须回传 `version`（乐观并发令牌），而管理员手上只有
 * 一个从审核页抄来的 ID。所以「输入 ID」这一步的真实含义是**先把这条记录
 * 取回来**，而不是把一个字符串直接发给写接口。
 *
 * 顺带解决了另一个问题：管理员在按下确认之前能看到这条记录是谁的、
 * 什么状态 —— 拿一个抄错的 ID 去作废别人的记录，是这一屏最贵的错误。
 */
const DEBOUNCE_MS = 300

export interface EntryLookup {
  detail: ReviewEntryDetail | null
  isLoading: boolean
  /** 查不到（ID 抄错、已删除、或根本不是一条记录） */
  isError: boolean
  refresh: () => void
}

export function useEntryLookup(entryId: string): EntryLookup {
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(entryId.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [entryId])

  const query = useQuery({
    queryKey: qk.admin.reviewDetail(debounced),
    queryFn: () => fetchReviewDetail(debounced),
    enabled: debounced.length > 0,
    // 抄错一个字符就会得到 404，自动重试三次只是让人多等两秒
    retry: false,
  })

  return {
    detail: query.data ?? null,
    isLoading: query.isFetching,
    isError: query.isError,
    refresh: () => void query.refetch(),
  }
}
