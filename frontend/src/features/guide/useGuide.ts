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
 * 「内容就绪 且 这次会话里没关过 且 （重播请求待兑现 / 已兑现过 /
 * 这个浏览器没看过）」。三个「要开」的理由都必须是重渲染翻不动的 ——
 * 前两个见 replayClaimed 的说明。
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

  /**
   * 这次播放是重播请求兑现来的。
   *
   * 必须落成状态，不能只认 isReplayRequested —— 那个请求在打开的瞬间
   * 就被 consume 掉了，而 open 是**渲染期推导**的：请求一没，下一次
   * 重渲染就会把它翻回 false，引导自己关掉。
   *
   * 主页面每秒因倒计时重渲染一次（useTicker），所以那里必然复现：
   * 在「我的」点「打卡流程说明」跳到首页，气泡出现不到 1 秒就消失 ——
   * 用户早看过（!hasSeen 为 false），重播请求是唯一撑着它开着的理由。
   * 排行榜没有 ticker，同样的 bug 只是没被触发出来。
   */
  const [replayClaimed, setReplayClaimed] = useState(false)

  /*
    渲染期把「这次是重播」记下来，而不是等 effect —— open 在同一帧就要
    用到它：effect 要等渲染提交之后才跑，那时 open 已经按「没有重播请求」
    算过一遍了，晚一帧就是气泡一闪而过。

    渲染期 setState 是 React 认可的「依据外部输入调整状态」写法
    （react.dev 的 you-might-not-need-an-effect），前提是有
    !replayClaimed 这样的收敛条件，否则每轮渲染都会再设一次。

    这里刻意不顺手 consumeReplayRequest —— 渲染可能被丢弃（StrictMode
    会把渲染跑两遍，并发渲染下也可能作废），那次播放就永远丢了。
    兑现仍然留在下面的 effect 里。
  */
  if (!replayClaimed && isReplayRequested(id)) setReplayClaimed(true)

  const open = ready && !closed && (isReplayRequested(id) || replayClaimed || !hasSeen(id))

  /*
    重播请求兑现掉。这里只改模块里那个变量，不碰 React 状态 ——
    放在渲染期反而不行，理由见上。
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
