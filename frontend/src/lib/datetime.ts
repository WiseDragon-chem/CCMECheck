import dayjs from 'dayjs'
import { zh } from '@/locales/zh-CN'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

/**
 * 时间处理的三条铁律。三条都是静默损坏 —— 出错时不会报错，只会显示错。
 */

/** 展示时区固定北京时间。中国不实行夏令时，偏移恒定。 */
export const DISPLAY_UTC_OFFSET_HOURS = 8

const WEEKDAYS = zh.dateTime.weekdays

/**
 * 铁律一：`YYYY-MM-DD` 一律当字符串处理，绝不交给 `new Date()`。
 *
 * JS 规范里 date-only 形式按 **UTC 午夜**解析，`new Date('2026-10-01')`
 * 在 +08:00 会渲染成 09-30。后端特意把活动日存成文本、让字典序等于时间序
 * （见 server/README 第 7.1 节），前端必须原样保住这个性质。
 *
 * 注意 dayjs 与 JS Date 的行为**不同**：dayjs('2026-10-01') 按本地时间解析。
 * 但为了不依赖这种差异，这里仍然手工拆字符串。
 */
export function parseDateOnly(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`不是合法的 YYYY-MM-DD：${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/** `2026-10-01` → `10月1日 周四` */
export function formatActivityDate(date: string): string {
  const { year, month, day } = parseDateOnly(date)
  // 本地午夜，不跨越任何时区边界
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日 ${weekday}`
}

/** `2026-10-01` → `2026年10月1日` */
export function formatActivityDateLong(date: string): string {
  const { year, month, day } = parseDateOnly(date)
  return `${year}年${month}月${day}日`
}

/**
 * 铁律二：时间戳是 ISO UTC，展示一律换算到北京时间。
 *
 * 不能依赖浏览器本地时区 —— 用户的设备可能设在任何时区，
 * 而活动的时间边界全部按北京时间定义。
 */
export function formatCst(iso: string, template = 'YYYY-MM-DD HH:mm'): string {
  return dayjs.utc(iso).utcOffset(DISPLAY_UTC_OFFSET_HOURS).format(template)
}

/** `2026-10-01T13:25:00Z` → `10月1日 21:25` */
export function formatCstFriendly(iso: string): string {
  const at = dayjs.utc(iso).utcOffset(DISPLAY_UTC_OFFSET_HOURS)
  return `${at.month() + 1}月${at.date()}日 ${at.format('HH:mm')}`
}

/** 仅时分，用于「重新开放至 14:30」这类提示 */
export function formatCstTime(iso: string): string {
  return dayjs.utc(iso).utcOffset(DISPLAY_UTC_OFFSET_HOURS).format('HH:mm')
}

/**
 * 由服务器时间算出本地时钟偏移。
 *
 * design.md §7.3 说得很明确：倒计时只用于提示，服务器时间负责最终判定。
 * 因此倒计时的基准是「服务器时间 + 本地流逝」，而不是设备时钟。
 */
export function clockOffsetMs(serverTimeIso: string): number {
  return Date.parse(serverTimeIso) - Date.now()
}

/** 把秒数格式化成「还有 3 小时 12 分」这类中文提示 */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return zh.dateTime.deadlinePassed
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours > 0) return zh.dateTime.remainingHoursMinutes(hours, minutes)
  if (minutes > 0) return zh.dateTime.remainingMinutesSeconds(minutes, total % 60)
  return zh.dateTime.remainingSeconds(total)
}
