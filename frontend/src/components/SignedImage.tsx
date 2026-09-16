import { useState } from 'react'
import { Button, Image, Skeleton } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useSignedAssetUrl } from '@/features/checkin/hooks/useSignedAssetUrl'
import { zh } from '@/locales/zh-CN'

/**
 * 展示一张受保护的证明材料。
 *
 * 调用方只给 entry/asset 的标识，签名地址由内部按需申请与续期 ——
 * 这样「地址会过期」这件事就只在这一个地方处理，而不是散落在
 * 记录页、详情页、审核页各自实现一遍。
 *
 * `previewable` 打开时内部改用 antd 的 Image：它自带放大、旋转与左右切换。
 * 早先的写法是在外面再套一层隐藏的 PreviewGroup 来提供预览，
 * 结果每个素材被渲染两遍 —— 隐藏那张因为 lazy + display:none 永远不会加载，
 * 白白多占一次签名请求和一份 DOM。
 */
export interface SignedImageProps {
  entryId: string
  assetId: string
  /** 已知尺寸时用来撑出占位盒子，避免图片到达时布局跳动 */
  width?: number | null
  height?: number | null
  alt: string
  /** 铺满父容器（列表缩略图）还是按原比例展示（详情页） */
  fit?: 'cover' | 'contain'
  /** 点击可放大预览 */
  previewable?: boolean
  onClick?: () => void
}

export default function SignedImage({
  entryId,
  assetId,
  width,
  height,
  alt,
  fit = 'cover',
  previewable = false,
  onClick,
}: SignedImageProps) {
  const { url, isLoading, isError, refresh } = useSignedAssetUrl(entryId, assetId)
  // 签名失效时 onError 会触发一次重签；用 key 强制 img 换一个节点，
  // 否则浏览器会沿用那条 404 的缓存
  const [attempt, setAttempt] = useState(0)
  const [failedOnce, setFailedOnce] = useState(false)

  // 已知尺寸时按比例撑出占位，避免图片到达前高度为 0 导致的跳动
  const aspectRatio = width && height ? `${width} / ${height}` : undefined

  if (isError || (failedOnce && !url)) {
    return (
      <div className="signed-image signed-image--failed" style={{ aspectRatio }}>
        <span>{zh.checkin.detail.imageLoadFailed}</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
          {zh.checkin.detail.reloadImage}
        </Button>
      </div>
    )
  }

  if (isLoading || !url) {
    return <Skeleton.Image active style={{ width: '100%', height: aspectRatio ? undefined : 120 }} />
  }

  const handleError = () => {
    setFailedOnce(true)
    setAttempt((value) => value + 1)
    // 地址多半是过期了，重签一次。只重试一次，避免死循环。
    if (attempt === 0) refresh()
  }

  // url 变化即为新的签名，换 key 可以绕开浏览器对旧地址的缓存
  const imageKey = `${url}-${attempt}`

  if (previewable) {
    return (
      <Image
        key={imageKey}
        className="signed-image"
        src={url}
        alt={alt}
        style={{ aspectRatio, objectFit: fit }}
        onError={handleError}
        onClick={onClick}
        preview={{ mask: zh.checkin.detail.viewLarger }}
      />
    )
  }

  return (
    <img
      key={imageKey}
      className="signed-image"
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      onClick={onClick}
      style={{
        aspectRatio,
        objectFit: fit,
        cursor: onClick ? 'zoom-in' : undefined,
      }}
      onError={handleError}
    />
  )
}
