import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Typography } from 'antd'
import { CloseOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons'
import { detectImageTypeFromFile, type DetectedImageType } from '@/lib/imageMagicBytes'

/**
 * 证明材料的选取、预览与排序（design.md §7.4）。
 *
 * 用 dnd-kit 而不是手写拖拽，是因为它自带 KeyboardSensor：
 * 空格拿起、方向键移动、空格放下 —— 键盘用户与读屏用户同样能用。
 * 单独再配一套「左移/右移」按钮反而重复。
 */

export interface SelectedImage {
  /** 稳定标识，用作 React key 与拖拽 id。不能用文件名（可能重名） */
  id: string
  file: File
  /** 预览用的 object URL，卸载或移除时必须 revoke */
  previewUrl: string
}

export interface UploadRules {
  min_images: number
  max_images: number
  max_image_bytes: number
  allowed_mime_types: string[]
}

export interface ImagePickerProps {
  value: SelectedImage[]
  onChange: (images: SelectedImage[]) => void
  rules: UploadRules
  disabled?: boolean
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `img-${idCounter}`
}

export function createSelectedImage(file: File): SelectedImage {
  return { id: nextId(), file, previewUrl: URL.createObjectURL(file) }
}

/** 释放不再使用的 object URL，否则手机上反复重选会吃光内存 */
export function releaseSelectedImages(images: SelectedImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.previewUrl)
}

const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}

function describeRules(rules: UploadRules): string {
  const formats = rules.allowed_mime_types.map((mime) => MIME_LABELS[mime] ?? mime).join('、')
  const mb = Math.round((rules.max_image_bytes / 1024 / 1024) * 10) / 10
  return `${rules.min_images}–${rules.max_images} 张，${formats}，单张不超过 ${mb} MB`
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

/**
 * 选图前的校验。
 *
 * 全部在本地先拦一遍：手机上传一张 10MB 的图要几十秒，
 * 等传完再被服务端拒绝是对用户时间的浪费。
 */
export async function validateFile(
  file: File,
  rules: UploadRules,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (file.size > rules.max_image_bytes) {
    const mb = Math.round((rules.max_image_bytes / 1024 / 1024) * 10) / 10
    return { ok: false, reason: `「${file.name}」${formatSize(file.size)}，超过单张 ${mb} MB 的限制` }
  }

  const detected: DetectedImageType = await detectImageTypeFromFile(file)
  if (!detected) {
    // §7.4：不接受仅修改扩展名的伪装文件
    return { ok: false, reason: `「${file.name}」不是有效的图片，可能只是改了扩展名` }
  }
  if (!rules.allowed_mime_types.includes(detected)) {
    return { ok: false, reason: `「${file.name}」是 ${detected}，当前活动不接受该格式` }
  }

  return { ok: true }
}

export { describeRules }

export default function ImagePicker({ value, onChange, rules, disabled }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 卸载时释放全部 object URL。
   *
   * 用 ref 存一份最新的，是因为卸载时拿不到当时的 props ——
   * 只依赖 [] 的 effect 会捕获到初始的空数组。
   */
  const latestImages = useRef(value)
  latestImages.current = value
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
        setError(`最多只能上传 ${rules.max_images} 张图片`)
        return
      }
      if (incoming.length > room) {
        setError(`最多还能再加 ${room} 张，已忽略多余的图片`)
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
                aria-label="添加证明材料"
              >
                <PlusOutlined style={{ fontSize: 20 }} />
                <span style={{ fontSize: 12 }}>添加图片</span>
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
        {value.length > 1 && ' · 拖动缩略图可调整顺序'}
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
      <img src={image.previewUrl} alt={`证明材料 ${index + 1}`} draggable={false} />

      <span className="image-thumb__order" aria-hidden>
        {index + 1}
      </span>

      {!disabled && (
        <Button
          type="text"
          size="small"
          className="image-thumb__remove"
          aria-label={`删除第 ${index + 1} 张`}
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
