import { useCallback, useEffect, useState } from 'react'
import { consumeReplayRequest, hasSeen, isReplayRequested, markSeen, type GuideId } from './guideIds'

export interface UseGuideOptions {
  /**
   * 页面的目标内容是否已经渲染出来。
   *
   * 主页面与排行榜都有加载中 / 加载失败 / 空状态三种提前 return，
   * 引导必须只在前面的分支都过去之后再开。各页把它算成一个普通的
   * 布尔量传进来 —— 注意 hook 的调用位置必须在那几个 return **之前**。
   */
  ready: boolean
}

export interface GuideState {
  open: boolean
  /** 当前第几步。由我们托管，否则关掉引导再重播会停在上次那一步 */
  current: number
  onChange: (next: number) => void
  onClose: () => void
}

/**
 * 操作指导的开关。
 *
 * 「开不开」是**渲染期直接推导**的，不走 effect：open 就是
 * 「内容就绪 且 这次会话里没关过 且 （有重播请求 或 这个浏览器没看过）」。
 *
 * 这么写不只是为了少一个 effect，更是因为页面的数据会反复重取
 * （react-query 的 staleTime 一到就重取，审核结果变化也会让卡片刷新）。
 * 若把判断放进 effect、由 ready 驱动，每轮重取都可能重新判一次，
 * 用户关掉引导十几秒后会被再弹一次；而推导式里「关过」和「看过」
 * 两个条件一旦成立就不会再变，天然不会复发。
 *
 * 「看过」标记在**关闭时**才写：中途关掉标签页等于没看完，下次再来一遍。
 * 关闭同时置一个本次会话的 closed —— 万一 localStorage 写不进去
 * （隐私模式），至少这一轮不会再弹。
 */
export function useGuide(id: GuideId, { ready }: UseGuideOptions): GuideState {
  const [closed, setClosed] = useState(false)
  const [current, setCurrent] = useState(0)

  const open = ready && !closed && (isReplayRequested(id) || !hasSeen(id))

  /*
    重播请求兑现掉。这里只改模块里那个变量，不碰 React 状态，
    所以放 effect 里是合适的；放在渲染期反而不行 —— StrictMode 会
    把渲染跑两遍，第一遍就把请求取走了，第二遍看到的是「没有请求」。
  */
  useEffect(() => {
    if (open) consumeReplayRequest(id)
  }, [open, id])

  const onClose = useCallback(() => {
    setClosed(true)
    setCurrent(0)
    markSeen(id)
  }, [id])

  return { open, current, onChange: setCurrent, onClose }
}
