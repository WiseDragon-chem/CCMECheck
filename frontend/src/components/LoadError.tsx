import type { ReactNode } from 'react'
import { Result } from 'antd'
import { isApiError } from '@/api/client'
import { presentError, requestIdSuffix } from '@/api/presentError'
import { zh } from '@/locales/zh-CN'

interface LoadErrorProps {
  /**
   * 失败的那个请求的 error。
   *
   * 页面同时挂了多个请求时，传**最说明问题**的那个（例如 409 优先于 500），
   * 因为副标题要说的是「为什么没加载出来」，而不是「哪个请求先失败」。
   */
  error: unknown
  /** 页面自己的标题（「没能加载X」）。没有活动时整个标题都会被替换掉。 */
  title: string
  /** 重试 / 返回等出口。各页面原有控件直接传进来，样式不变。 */
  extra?: ReactNode
}

/**
 * 加载失败的统一展示。
 *
 * 副标题必须来自**真实原因**。此前各页面一律写死「请检查网络后重试。」，
 * 于是「当前没有进行中的活动」（409 CAMPAIGN_NOT_ACTIVE）也被说成网络问题 ——
 * 用户反复重试也修不好，真正的原因（活动未发布/已归档）反倒没人知道。
 * 这个码由后端 requireCurrentCampaign 抛出，登录首屏与几乎每个数据页都会撞上，
 * 所以它是独立状态而不是一种错误。
 *
 * 真正的网络故障（fetch 抛出的非 ApiError）才配用网络文案：服务端错误有自己的
 * message，直接透传比前端猜更准（design.md §12.5：分支看 code，文案看服务端）。
 */
export default function LoadError({ error, title, extra }: LoadErrorProps) {
  const presented = presentError(error)

  if (presented.code === 'CAMPAIGN_NOT_ACTIVE') {
    return (
      <Result
        status="info"
        title={zh.common.noCampaign}
        subTitle={zh.common.noCampaignDetail}
        extra={extra}
      />
    )
  }

  const reason = isApiError(error)
    ? `${presented.text}${requestIdSuffix(presented)}`
    : zh.common.loadFailed

  return <Result status="warning" title={title} subTitle={reason} extra={extra} />
}
