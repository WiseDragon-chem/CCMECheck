import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Typography } from 'antd'
import { CloseOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons'
import { zh } from '@/locales/zh-CN'
import {
  createSelectedImage,
  describeRules,
  releaseSelectedImages,
  validateFile,
  type SelectedImage,
  type UploadRules,
} from './imagePicker.utils'

/**
 * 证明材料的选取、预览与排序（design.md §7.4）。
 *
 * 用 dnd-kit 而不是手写拖拽，是因为它自带 KeyboardSensor：
 * 空格拿起、方向键移动、空格放下 —— 键盘用户与读屏用户同样能用。
 * 单独再配一套「左移/右移」按钮反而重复。
 *
 * 类型与纯函数都在 imagePicker.utils.ts。组件文件里一旦出现非组件的导出，
 * 热更新就会退化成整页刷新 —— 改一行样式都要重新走一遍登录。
 */
export interface ImagePickerProps {
  value: SelectedImage[]
  onChange: (images: SelectedImage[]) => void
  rules: UploadRules
  disabled?: boolean
}

export default function ImagePicker({ value, onChange, rules, disabled }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 卸载时释放全部 object URL。
   *
   * 用 ref 存一份最新的，是因为卸载时拿不到当时的 props ——
   * 只依赖 [] 的 effect 会捕获到初始的空数组。
   *
   * ref 的更新必须放在 effect 里而不是渲染期：渲染期改 ref 在并发渲染下
   * 会出错（React 可能丢弃或重放一次渲染），而且 react-hooks 会直接报错。
   */
  const latestImages = useRef(value)
  useEffect(() => {
    latestImages.current = value
  })
  useEffect(() => () => releaseSelectedImages(latestImages.current), [])

  const sensors = useSensors(
    // 拖动 8px 以上才算拖拽，否则手机上滑动页面会误触发排序
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      setError(null)

      const incoming = Array.from(files)
      const room = rules.max_images - value.length
      if (room <= 0) {
        setError(zh.checkin.submit.tooManyImages(rules.max_images))
        return
      }
      if (incoming.length > room) {
        setError(zh.checkin.submit.ignoredExtra(room))
      }

      const accepted: SelectedImage[] = []
      const problems: string[] = []

      for (const file of incoming.slice(0, room)) {
        const result = await validateFile(file, rules)
        if (result.ok) accepted.push(createSelectedImage(file))
        else problems.push(result.reason)
      }

      if (problems.length > 0) setError(problems.join('；'))
      if (accepted.length > 0) onChange([...value, ...accepted])
    },
    [onChange, rules, value],
  )

  const remove = (id: string) => {
    const target = value.find((image) => image.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    onChange(value.filter((image) => image.id !== id))
    setError(null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = value.findIndex((image) => image.id === active.id)
    const to = value.findIndex((image) => image.id === over.id)
    if (from < 0 || to < 0) return

    const next = [...value]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    onChange(next)
  }

  const canAddMore = value.length < rules.max_images && !disabled
  const ids = useMemo(() => value.map((image) => image.id), [value])

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToParentElement]}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="image-grid">
            {value.map((image, index) => (
              <SortableThumb
                key={image.id}
                image={image}
                index={index}
                disabled={disabled}
                onRemove={() => remove(image.id)}
              />
            ))}

            {canAddMore && (
              <button
                type="button"
                className="image-picker__add"
                onClick={() => inputRef.current?.click()}
                aria-label={zh.checkin.submit.addImage}
              >
                <PlusOutlined style={{ fontSize: 20 }} />
                <span style={{ fontSize: 12 }}>{zh.checkin.submit.addImage}</span>
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <input
        ref={inputRef}
        type="file"
        accept={rules.allowed_mime_types.join(',')}
        multiple={rules.max_images > 1}
        hidden
        onChange={(event) => {
          void handleFiles(event.target.files)
          // 清空以便重复选择同一个文件时仍能触发 change
          event.target.value = ''
        }}
      />

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        {describeRules(rules)}
        {value.length > 1 && zh.checkin.submit.dragToReorder}
      </Typography.Text>

      {error && (
        <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {error}
        </Typography.Text>
      )}
    </div>
  )
}

function SortableThumb({
  image,
  index,
  disabled,
  onRemove,
}: {
  image: SelectedImage
  index: number
  disabled?: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      className={`image-thumb${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 键盘操作需要 tabindex，dnd-kit 通过 attributes 提供
      {...attributes}
      {...listeners}
    >
      <img src={image.previewUrl} alt={zh.checkin.submit.proofAlt(index)} draggable={false} />

      <span className="image-thumb__order" aria-hidden>
        {index + 1}
      </span>

      {!disabled && (
        <Button
          type="text"
          size="small"
          className="image-thumb__remove"
          aria-label={zh.checkin.submit.deleteImage(index)}
          // 阻止冒泡，否则点删除会被当成开始拖拽
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <CloseOutlined />
        </Button>
      )}

      <span className="image-thumb__handle" aria-hidden>
        <HolderOutlined />
      </span>
    </div>
  )
}
