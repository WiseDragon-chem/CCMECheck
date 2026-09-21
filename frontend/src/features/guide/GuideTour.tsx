import type { ReactNode } from 'react'
import { Tour, Typography } from 'antd'
import type { TourProps } from 'antd'
import { zh } from '@/locales/zh-CN'
import type { GuideId } from './guideIds'
import { useGuide } from './useGuide'

export interface GuideStep {
  /**
   * 目标元素的 `data-tour` 值。
   *
   * 用属性选择器而不是 ref 传递：目标散落在页面各处（卡片内部的标签、
   * 表单里的某一项），逐个透传 ref 要改好几个组件的 props 签名；
   * 而 rc-tour 每次渲染都会重新调用 target()，元素晚一步挂载也能命中。
   *
   * 目标找不到时 rc-tour 会把气泡居中显示且不高亮，不会崩 —— 所以
   * 目标偶尔缺席（比如某张卡片状态不同）是可以接受的，不必为此加判断。
   */
  target: string
  title: string
  body: ReactNode
  /** 可选的小字步骤提示，显示在正文上方 */
  step?: string
}

export interface GuideTourProps {
  id: GuideId
  /** 目标内容是否已渲染。各页见 useGuide 的说明 */
  ready: boolean
  steps: GuideStep[]
}

/**
 * 操作指导的气泡。
 *
 * **必须放在页面 JSX 的最后一个子元素**，排在所有 data-tour 目标之后：
 * rc-tour 在 useLayoutEffect 里量目标的位置，放最后能保证目标都已进 DOM。
 *
 * 两点 antd 默认行为值得记住（都是这个组件赖以工作的前提）：
 *
 *   * `disabledInteraction` 默认为 false，遮罩层因此带 `pointer-events: none`，
 *     **被高亮的那块仍然可点**，其余区域被四块透明矩形挡住且不会误关引导。
 *     登录页那步就靠这个让用户直接点「去激活」。
 *   * 点遮罩不会关闭，出口只有右上角的 × 和底部的按钮 —— 两步都能走到
 *     onClose，所以「看过」标记不会漏写。
 */
export default function GuideTour({ id, ready, steps }: GuideTourProps) {
  const { open, current, onChange, onClose } = useGuide(id, { ready })

  const tourSteps: TourProps['steps'] = steps.map((step, index) => ({
    title: step.title,
    description: (
      <>
        {step.step && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {step.step}
          </Typography.Text>
        )}
        {step.body}
      </>
    ),
    /*
      找不到目标时返回 null。rc-tour 本身是允许的（useTarget.js 里就是
      `setTargetElement(nextElement || null)`，随后把气泡居中且不高亮），
      但它的类型只声明了 `() => HTMLElement` 与 `() => null` 两支，
      不认这个联合，所以这里断言一次。断言的是它运行时确实支持的行为。
    */
    target: (() =>
      document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)) as () => HTMLElement,
    /*
      最后一步用「知道了」而不是 antd 默认的「完成」。这套引导只讲事、
      不做操作，「完成」会让人以为刚才完成了什么。
      中间的步骤沿用 antd 自带的「下一步 / 上一步」。
    */
    ...(index === steps.length - 1 ? { nextButtonProps: { children: zh.tour.done } } : {}),
  }))

  return <Tour open={open} current={current} onChange={onChange} onClose={onClose} steps={tourSteps} />
}
