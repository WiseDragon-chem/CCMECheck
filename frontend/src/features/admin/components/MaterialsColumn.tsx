import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  RotateRightOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import { Button, Empty, Space, Tooltip, Typography } from 'antd'
import SignedImage from '@/components/SignedImage'
import { zh } from '@/locales/zh-CN'
import { useHotkeys } from '../hooks/useHotkeys'

/**
 * 审核页中栏：证明材料（design.md §8.2）。
 *
 * 缩放、旋转、全屏都是**自己实现**的，没有用 antd `Image` 的预览：
 * 预览层是 portal，打开时键盘事件照样落到 window 上，
 * 于是「看着大图按了一下 A」会直接通过一条正在看的记录。
 * 自己持有状态才能在预览打开时把决策键关掉（见 useHotkeys 的注释）。
 */
export interface MaterialAsset {
  asset_id: string
  width: number | null
  height: number | null
}

export interface MaterialsColumnProps {
  entryId: string
  assets: MaterialAsset[]
  /** 补录的记录没有材料，文案要说明「这是正常的」而不是当成错误 */
  isManual: boolean
  /** 缩放/旋转/全屏状态变化时告知页面，用于闸掉决策快捷键 */
  onViewModeChange: (busy: boolean) => void
  /** 弹窗打开时关掉 `+` / `-`，避免在填写驳回原因时把图缩没 */
  hotkeysEnabled: boolean
}

const ZOOM_STEP = 1.25
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8

/** 下一档缩放比例，键盘与按钮共用 */
function nextZoom(current: number, direction: 1 | -1): number {
  const next = direction === 1 ? current * ZOOM_STEP : current / ZOOM_STEP
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(4))))
}

/** 视角：缩放、旋转与当前看第几张 */
interface ViewState {
  /** 这份视角属于哪一条记录 */
  entryId: string
  activeIndex: number
  zoom: number
  rotation: number
}

const INITIAL_VIEW = (entryId: string): ViewState => ({ entryId, activeIndex: 0, zoom: 1, rotation: 0 })

export default function MaterialsColumn({
  entryId,
  assets,
  isManual,
  onViewModeChange,
  hotkeysEnabled,
}: MaterialsColumnProps) {
  /**
   * 视角状态**带着它属于哪一条记录**一起存。
   *
   * 换记录时不该把上一条的缩放带过来：上一条放大到 4 倍，下一条会从
   * 一个只看得见一角的画面开始，而审核员会以为材料本身就是糊的。
   *
   * 用「记着归属、不匹配就取初始值」来做到这一点，而不是在 effect 里
   * 重置 —— 后者会多一次渲染，而且 reset 的那一帧仍然画着旧缩放，
   * 眼睛能看见那一下跳动。这里当前视角是渲染期算出来的，永远不会画错。
   */
  const [stored, setStored] = useState<ViewState>(() => INITIAL_VIEW(entryId))
  const view = stored.entryId === entryId ? stored : INITIAL_VIEW(entryId)

  const patch = (changes: Partial<Omit<ViewState, 'entryId'>>) =>
    setStored({ ...view, ...changes })

  const [fullscreen, setFullscreen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  /**
   * 全屏只能通过 Fullscreen API 退出（浏览器接管了 Esc），
   * 因此状态必须跟着 fullscreenchange 走，不能只在自己按按钮时改 ——
   * 否则用户按 Esc 退出后，界面仍以为在全屏，决策键被永久闸掉。
   */
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement === stage) void document.exitFullscreen()
    else void stage.requestFullscreen().catch(() => undefined)
  }, [])

  // 把「正在看图」这件事告诉页面。全屏时决策键必须停用。
  useEffect(() => {
    onViewModeChange(fullscreen)
  }, [fullscreen, onViewModeChange])

  /**
   * 缩放热键（design.md §8.2 的 `+` / `-`）。
   *
   * 绑在这一层而不是页面上：缩放比例是这一层的局部状态，
   * 把它提到页面只为了让快捷键够得着，会让页面多背两个与它无关的 state。
   *
   * `=` 与 `+` 是同一个物理键的不同 shift 状态 —— 大多数键盘布局上
   * 按 `+` 必须按 shift，而 shift 组合不会被 shouldHandleKey 挡掉，
   * 但用户常常只是按了 `=`。两个都收下。
   */
  useHotkeys(
    [
      { key: '+', handler: () => patch({ zoom: nextZoom(view.zoom, 1) }) },
      { key: '=', handler: () => patch({ zoom: nextZoom(view.zoom, 1) }) },
      { key: '-', handler: () => patch({ zoom: nextZoom(view.zoom, -1) }) },
    ],
    { enabled: hotkeysEnabled && assets.length > 0 },
  )

  const asset = assets[view.activeIndex]
  const canZoom = assets.length > 0

  return (
    <div className="review-pipeline__col review-pipeline__col--materials">
      <div className="materials-toolbar">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {assets.length > 0 && zh.admin.review.assetIndex(view.activeIndex + 1, assets.length)}
        </Typography.Text>

        <Space size={4}>
          <Tooltip title={zh.admin.review.zoomOut}>
            <Button
              size="small"
              type="text"
              disabled={!canZoom}
              icon={<ZoomOutOutlined />}
              onClick={() => patch({ zoom: nextZoom(view.zoom, -1) })}
            />
          </Tooltip>
          <Typography.Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>
            {Math.round(view.zoom * 100)}%
          </Typography.Text>
          <Tooltip title={zh.admin.review.zoomIn}>
            <Button
              size="small"
              type="text"
              disabled={!canZoom}
              icon={<ZoomInOutlined />}
              onClick={() => patch({ zoom: nextZoom(view.zoom, 1) })}
            />
          </Tooltip>
          <Tooltip title={zh.admin.review.rotate}>
            <Button
              size="small"
              type="text"
              disabled={!canZoom}
              icon={<RotateRightOutlined />}
              onClick={() => patch({ rotation: (view.rotation + 90) % 360 })}
            />
          </Tooltip>
          <Tooltip title={zh.admin.review.resetView}>
            <Button
              size="small"
              type="text"
              disabled={!canZoom}
              icon={<ReloadOutlined />}
              onClick={() => patch({ zoom: 1, rotation: 0 })}
            />
          </Tooltip>
          <Tooltip title={fullscreen ? zh.admin.review.exitFullscreen : zh.admin.review.fullscreen}>
            <Button
              size="small"
              type="text"
              disabled={!canZoom}
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </Space>
      </div>

      <div className="materials-stage" ref={stageRef}>
        {!asset ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={isManual ? zh.admin.review.manualNoMaterials : zh.admin.review.noMaterials}
          />
        ) : (
          <div
            className="materials-canvas"
            style={{ transform: `scale(${view.zoom}) rotate(${view.rotation}deg)` }}
          >
            <SignedImage
              entryId={entryId}
              assetId={asset.asset_id}
              width={asset.width}
              height={asset.height}
              fit="contain"
              alt={zh.admin.review.materialsAlt(view.activeIndex + 1)}
            />
          </div>
        )}
      </div>

      {/* 只有一张时不画缩略图 —— 一个孤零零的方框会让人以为还有别的没加载 */}
      {assets.length > 1 && (
        <div className="materials-thumbs">
          {assets.map((item, index) => (
            <div
              key={item.asset_id}
              className={`materials-thumb${index === view.activeIndex ? ' is-active' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={zh.admin.review.switchAsset(index + 1)}
              onClick={() => patch({ activeIndex: index })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  patch({ activeIndex: index })
                }
              }}
            >
              <SignedImage
                entryId={entryId}
                assetId={item.asset_id}
                width={item.width}
                height={item.height}
                alt={zh.admin.review.materialsAlt(index + 1)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
