import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select, Typography } from 'antd'
import { qk } from '@/api/queryKeys'
import type { AdminParticipant } from '@/api/types'
import { zh } from '@/locales/zh-CN'
import { fetchParticipants } from '../api/misc'

/**
 * 搜索并选择一个参赛者（§8.5 的补录与积分调整都要）。
 *
 * 两个刻意的取舍：
 *
 *   1. **不预载全部名单。** 参赛人数是几百到几千，一次性拉下来既慢又
 *      在管理端每个页面各存一份。改成输入即搜（服务端有 keyword 索引）。
 *
 *   2. **允许把用户填的关键字原样提交。** 搜索用的是受控输入，
 *      但选择结果只认下拉里的条目 —— 手打一个姓名不会被当成参赛者。
 *      否则「补录给一个并不存在的人」会走到服务端去报一个难懂的外键错误。
 */
export interface ParticipantPickerProps {
  value: AdminParticipant | null
  onChange: (participant: AdminParticipant | null) => void
  disabled?: boolean
}

/** 输入停顿多久才发请求。太短会在输入学号时发出十几个请求 */
const DEBOUNCE_MS = 250

export default function ParticipantPicker({ value, onChange, disabled }: ParticipantPickerProps) {
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(keyword.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [keyword])

  const filters = { keyword: debounced, page_size: 20 }

  const query = useQuery({
    queryKey: qk.admin.participants(filters),
    queryFn: () => fetchParticipants(filters),
    // 没输入关键字时不搜 —— 否则一打开页面就是一次全表分页
    enabled: debounced.length > 0,
    // 同一个关键字重复输入很常见，短时间内不必重查
    staleTime: 30_000,
  })

  const options = (query.data?.items ?? []).map((item) => ({
    value: item.id,
    label: `${item.name}（${item.student_id}${item.class_name ? ` · ${item.class_name}` : ''}）`,
    participant: item,
  }))

  return (
    <Select
      showSearch
      allowClear
      disabled={disabled}
      style={{ width: '100%' }}
      placeholder={zh.admin.ops.participantSearch}
      value={value?.id}
      // 服务端已经按学号/姓名过滤，前端再过滤一次会把结果又筛掉一半
      filterOption={false}
      onSearch={setKeyword}
      loading={query.isFetching}
      notFoundContent={debounced && !query.isFetching ? zh.admin.common.notParticipant : null}
      options={options}
      onChange={(id: string | undefined) => {
        const picked = options.find((option) => option.value === id)
        onChange(picked?.participant ?? null)
      }}
      labelRender={() =>
        value ? (
          <Typography.Text>
            {value.name}
            <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
              {value.student_id}
            </Typography.Text>
          </Typography.Text>
        ) : null
      }
    />
  )
}
