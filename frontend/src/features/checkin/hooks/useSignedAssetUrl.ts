import { useQuery } from '@tanstack/react-query'
import { fetchSignedAssetUrl } from '@/api/endpoints/checkins'
import { qk } from '@/api/queryKeys'

/**
 * 证明材料的短期签名地址（design.md §13）。
 *
 * 两件事必须做对：
 *
 *   1. **缓存**。签名是每个素材一次调用，而列表滚动、组件重渲染都会
 *      重复触发。`staleTime` 设在有效期之内，避免同一张图反复签发。
 *
 *   2. **到期前重签**。地址默认 10 分钟失效，审核页或详情页停留久了
 *      图片就会集体裂掉。用 `refetchInterval` 在到期前 60 秒自动换新，
 *      而查询只在组件挂载时活跃，所以不会在后台空转。
 */

/** 提前多久重签，避开网络往返的延迟 */
const RENEW_AHEAD_MS = 60_000

export interface SignedAsset {
  url: string
  expiresAt: string
}

export function useSignedAssetUrl(entryId: string | undefined, assetId: string | undefined) {
  const enabled = Boolean(entryId && assetId)

  const query = useQuery({
    queryKey: qk.signedAsset(entryId ?? '', assetId ?? ''),
    queryFn: () => fetchSignedAssetUrl(entryId as string, assetId as string),
    enabled,
    // 在有效期内不重复签发。签名地址是能力凭证，多签一次没有额外风险，
    // 但会让一次滚动变成几十个请求。
    staleTime: (query) => {
      const data = query.state.data
      if (!data) return 0
      return Math.max(0, data.expires_in * 1000 - RENEW_AHEAD_MS)
    },
    // 到期前自动换一张新的
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return Math.max(30_000, data.expires_in * 1000 - RENEW_AHEAD_MS)
    },
  })

  return {
    url: query.data?.url ?? null,
    expiresAt: query.data?.expires_at ?? null,
    isLoading: enabled && query.isPending,
    isError: query.isError,
    refresh: () => void query.refetch(),
  }
}
