import { Carousel } from 'antd'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { zh } from '@/locales/zh-CN'
import { SPONSOR_IMAGES, type SponsorImage } from './sponsorImages'

/**
 * 赞助商展示位：首页与「我的」页最下方的那一条。
 *
 * **图片铺满可用宽度（最多 500px），高度按图片自己的比例来 —— 页面该滚就滚。**
 * 这是产品改的方向：赞助图要尽量大，宁可让页面出现滚动条，也不再压小画面。
 * 那个 500px 的宽度上限（`.sponsor` 上的一条 `max-width`）是为了桌面：
 * 首页内容区有 992px，不限宽的话图按比例要 684px 高，一条广告占满整屏。
 *
 * 所以这里**一个尺寸都不算**：高度由图片自己撑起来（CSS 里 `width: 100%;
 * height: auto`），没有测量、没有上限、没有 CSS 变量。上一版按页面剩余空间
 * 算高度（88–160px）是为了守住参赛者端「一屏放得下」，那条要求已经不再
 * 约束这个展示位 —— 取舍与实测数字见 design.md §7.7。
 *
 * 多家赞助商时画面框取**最高的那一张**：slick 的轨道是一行浮动，框会把最高
 * 的一张兜住，矮的那几张在下面留白（不裁切、不拉扁）。要看不见这段留白，
 * 办法是同一批图用同一个比例 —— 那是对组织者的要求，写在
 * src/assets/sponsors/README.md 里。
 *
 * 图片不可点击（产品：纯展示），所以这里没有 <a>。
 */
export interface SponsorBannerProps {
  /** 可注入，便于测试；默认取 src/assets/sponsors/ 下的全部图片 */
  items?: readonly SponsorImage[]
}

/** slick 默认 3 秒，对一张 logo 来说太快，像是闪了一下 */
const AUTOPLAY_MS = 4000

export default function SponsorBanner({ items = SPONSOR_IMAGES }: SponsorBannerProps) {
  const reduceMotion = usePrefersReducedMotion()

  // 没有赞助商时整块不渲染：不留空位，也不留一行孤零零的「感谢」
  if (items.length === 0) return null

  const single = items.length === 1 ? items[0] : null

  return (
    <section className="sponsor">
      {/*
        名字单独包一层 <strong> 加粗。整行都加粗就分不出主次了，
        所以 thanks 与 thanksBrand 在文案里就是分开的两段（见 zh-CN.ts）。
      */}
      <p className="sponsor__thanks">
        {zh.sponsor.thanks}
        <strong className="sponsor__thanks-brand">{zh.sponsor.thanksBrand}</strong>
      </p>
      <div className="sponsor__frame">
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
