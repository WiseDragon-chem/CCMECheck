import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchSignedAssetUrl } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'
import { fetchReviewDetail } from '../api/reviews'

/**
 * 预取下一份材料（design.md §8.2「系统应预加载下一份材料」）。
 *
 * 审核的节奏是「看一眼、按键、下一条」，任何一条出现 loading 都会打断它。
 * 所以要提前把下一条的**详情**与**第一张图的字节**都拉到本地：
 *
 *   1. 详情进 TanStack Query 缓存 —— 光标移过去时 `useQuery` 直接命中，
 *      右栏不会先空一下再填满。
 *   2. 图片走浏览器缓存预热。只签地址是不够的：签名只换来一个 URL，
 *      `<img>` 不渲染就永远不会发那次请求。所以这里用 `new Image()`
 *      真的把它下下来。
 *
 * 只预取**下一条**。再多就是在浪费带宽，而且审核员随时可能跳着审 ——
 * 预取五条、实际走两条是常态。
 *
 * 已决记录不计入：`entryId` 由调用方按可见队列给出。
 */
export function usePreloadEntry(entryId: string | null): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!entryId) return

    // 组件卸载或光标又动了之后，这次预取的结果就不该再往浏览器缓存里塞 ——
    // 那会白白占住内存，也可能把一张敏感的截图留在缓存里更久
    let cancelled = false

    void (async () => {
      try {
        const detail = await queryClient.fetchQuery({
          queryKey: qk.admin.reviewDetail(entryId),
          queryFn: () => fetchReviewDetail(entryId),
        })
        if (cancelled) return

        const first = detail.current_revision?.assets[0]
        if (!first) return

        const signed = await queryClient.fetchQuery({
          queryKey: qk.signedAsset(entryId, first.asset_id),
          queryFn: () => fetchSignedAssetUrl(entryId, first.asset_id),
        })
        if (cancelled) return

        // 这一句才是真正的「预加载」：前两步只是拿到了地址
        const image = new Image()
        image.src = signed.url
      } catch {
        // 预取失败无所谓，光标移过去时会重新取一遍。
        // 这里刻意不报错 —— 为一条还没被看的记录弹一个错误提示是噪音。
      }
    })()

    return () => {
      cancelled = true
    }
  }, [entryId, queryClient])
}
