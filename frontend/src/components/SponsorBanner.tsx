import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Carousel } from 'antd'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { zh } from '@/locales/zh-CN'
import { SPONSOR_IMAGES, type SponsorImage } from './sponsorImages'

/**
 * 赞助商展示位：首页与「我的」页最下方的那一条。
 *
 * **高度按页面上方内容剩下来的空间算（88–160px），不写死。** 写死一个值，
 * 放到两页上必然一头浪费一头不够 —— 实测同一时刻首页只剩 116px 可用、
 * 「我的」页有 229px。按剩余空间算则两页各自用满，且谁都不必迁就对方。
 *
 * 空间不够时**不再往下缩**，而是让页面滚（下限 88px，见下面那条常量）。
 *
 * 图片的尺寸永远不参与布局：高度是算出来的像素值，压在图片上，
 * 所以换任意比例的图，页面高度都不变。
 *
 * 图片不可点击（产品：纯展示），所以这里没有 <a>。
 */
export interface SponsorBannerProps {
  /** 可注入，便于测试；默认取 src/assets/sponsors/ 下的全部图片 */
  items?: readonly SponsorImage[]
}

/** slick 默认 3 秒，对一张 logo 来说太快，像是闪了一下 */
const AUTOPLAY_MS = 4000

/**
 * 下限 88px —— 到这儿就不再往下缩了。
 *
 * 这一条是产品定的：**宁可让页面出现滚动条，也不把广告位压成一条**。
 * 所以「首页放不下」这件事的处置方式是滚动，而不是继续压缩画面。
 * 实测会触到这条线的是：活动未开放/已结束（首页顶部多一条提示横幅）、
 * 当天有多条驳回记录 —— 那里首页会滚，见 design.md §7.7。
 */
const MIN_FRAME_HEIGHT = 88

/** 「我的」页能给出 200 多像素，但一个广告占掉半屏也不合适 */
const MAX_FRAME_HEIGHT = 160

/**
 * 留 2px 余量：布局是小数像素，取整后可能正好比可用空间多出不到 1px，
 * 而多 1px 就够让页面出现滚动条。
 */
const SAFETY_PX = 2

/**
 * 画面框还能有多高。
 *
 * 下界取底部导航的上沿（桌面上导航在顶部，那时以视口底边为界），
 * 再让开页面自己的下内边距 —— 否则最后那 16px 会被算进可用空间里，
 * 算出来的高度正好把页面顶出滚动条。
 */
function availableHeight(frame: HTMLElement): number {
  const navRect = document.querySelector('.bottom-nav')?.getBoundingClientRect()
  // height 为 0 说明导航在这一档布局里是隐藏的（≥992 的桌面形态）
  const limit = navRect && navRect.height > 0 ? navRect.top : window.innerHeight

  const page = frame.closest('.page')
  const pagePaddingBottom = page ? Number.parseFloat(getComputedStyle(page).paddingBottom) || 0 : 0

  return limit - frame.getBoundingClientRect().top - pagePaddingBottom
}

function clampFrameHeight(available: number): number {
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.round(available)))
}

export default function SponsorBanner({ items = SPONSOR_IMAGES }: SponsorBannerProps) {
  const reduceMotion = usePrefersReducedMotion()
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_HEIGHT)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const measure = () => setFrameHeight(clampFrameHeight(availableHeight(frame) - SAFETY_PX))

    measure()
    // 视口变高变矮：转屏、桌面窗口缩放
    window.addEventListener('resize', measure)

    /*
      上方内容变高变矮也要重算：手机上展开「修改密码」、当天多一行驳回原因都算。
      观察 .page 而不是画面框自己 —— 框自己的高度不参与它自己顶边的计算
      （它是页面最后一个元素），所以重算出来的值立刻稳定；万一多算了一轮，
      setState 同样的数字会被 React 直接忽略，不会来回抖。
      撞到 88px 下限之后，上方再怎么长它都不动了，页面从那时起开始滚。
    */
    const observed = frame.closest('.page') ?? frame.parentElement
    const observer = new ResizeObserver(measure)
    if (observed) observer.observe(observed)

    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [])

  // 没有赞助商时整块不渲染：不留空位，也不留一行孤零零的「感谢」
  if (items.length === 0) return null

  const single = items.length === 1 ? items[0] : null

  return (
    <section className="sponsor">
      <p className="sponsor__thanks">{zh.sponsor.thanks}</p>
      {/*
        高度走 CSS 变量，而不是直接写在图片的 style 上。

        **antd Carousel 会把每个子元素的行内样式整个换掉**：底层
        @ant-design/react-slick 的 slider.js 用一份固定的
        `{ width: '100%', display: 'inline-block' }` 去 clone 子元素，
        并不合并原本的 style（track.js 那条路径会合并，这条不会）。
        于是图片自己身上的行内高度留不住，图片就按原始比例铺开了。
        变量设在父元素上、由 class 消费，slick 碰不到它。
      */}
      <div
        className="sponsor__frame"
        ref={frameRef}
        style={{ '--sponsor-height': `${frameHeight}px` } as CSSProperties}
      >
        {single ? (
          // 只有一家时不套轮播：一张图既不该有圆点，也不该自己动
          <img className="sponsor__img" src={single.src} alt={single.alt} />
        ) : (
          <Carousel
            autoplay={!reduceMotion}
            autoplaySpeed={AUTOPLAY_MS}
            /*
              不要指示点。antd 默认是开的，必须显式关掉。
              那一排小横条（当前那张宽一些、深一些）落在画面底部，看上去
              就是一条横向滚动条 —— 产品明确要求去掉。
              代价：开了「减少动态效果」的用户本来就不自动播放，这下也没有
              圆点可点，只能看到第一张。一次放多家的活动要留意这一点。
            */
            dots={false}
            // 淡入淡出而不是横向滑动：滑动的无限循环会让 slick 克隆 slide，
            // 同一张图成倍出现在 DOM 与无障碍树里（淡入不克隆）。
            effect="fade"
            // 减少动效时连手动切换也直接跳过去，不留一段渐隐
            speed={reduceMotion ? 0 : 400}
          >
            {items.map((item) => (
              <img key={item.src} className="sponsor__img" src={item.src} alt={item.alt} />
            ))}
          </Carousel>
        )}
      </div>
    </section>
  )
}
