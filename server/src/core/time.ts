import { CHINA_UTC_OFFSET_MINUTES } from '../config/constants.js'

/**
 * 北京时间算术。
 *
 * design.md §6.2：服务器统一保存 UTC，同时为每条打卡记录单独保存 activity_date；
 * 中国不实行夏令时，所有截止时间按固定 +08:00 偏移换算，不引入时区数据库依赖。
 * 因此这里全部是纯整数运算，不依赖 Intl 或任何 tz 数据，
 * 结果也不受服务器 TZ 环境变量影响。
 */

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const CST_OFFSET_MS = CHINA_UTC_OFFSET_MINUTES * MS_PER_MINUTE

/** YYYY-MM-DD */
export type DateOnly = string

/**
 * 截断到秒。
 *
 * 用于 password_changed_at：JWT 的 iat 只有秒级精度，
 * 若密码变更时间带毫秒，同一秒内签发的新令牌会被判定为「早于改密时间」而立即失效。
 * 截断到秒后，比较用严格小于，同秒签发的令牌可以正常使用。
 */
export function truncateToSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000)
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 用 UTC 取值器把 Date 格式化成 YYYY-MM-DD */
function formatUtcDate(date: Date): DateOnly {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

interface DateParts {
  year: number
  month: number
  day: number
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false
  const parts = parseDateOnly(value)
  // 排除 2026-02-30 这类字形合法但日历上不存在的日期
  return formatUtcDate(makeUtcDate(parts)) === value
}

export function parseDateOnly(value: string): DateParts {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) throw new Error(`不是合法的 YYYY-MM-DD 日期：${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value)
}

/** 以 UTC 午夜为基准构造日期，只用于日期运算（不表示任何真实时刻） */
function makeUtcDate(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

/**
 * 某个 UTC 时刻对应的北京时间日历日期。
 * 这是 activity_date 的唯一来源。
 */
export function toActivityDate(instant: Date): DateOnly {
  return formatUtcDate(new Date(instant.getTime() + CST_OFFSET_MS))
}

/** 北京时间的「今天」 */
export function cstToday(now: Date = new Date()): DateOnly {
  return toActivityDate(now)
}

/** 北京时间的 HH:mm */
export function cstTimeOfDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + CST_OFFSET_MS)
  return `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`
}

/** 日期加减，纯字符串进、纯字符串出 */
export function addDays(date: DateOnly, days: number): DateOnly {
  const base = makeUtcDate(parseDateOnly(date))
  return formatUtcDate(new Date(base.getTime() + days * MS_PER_DAY))
}

/** b - a，单位为天 */
export function diffDays(a: DateOnly, b: DateOnly): number {
  const left = makeUtcDate(parseDateOnly(a)).getTime()
  const right = makeUtcDate(parseDateOnly(b)).getTime()
  return Math.round((right - left) / MS_PER_DAY)
}

/** 字典序即时间序，可直接比较 */
export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isWithinRange(date: DateOnly, start: DateOnly, end: DateOnly): boolean {
  return compareDateOnly(date, start) >= 0 && compareDateOnly(date, end) <= 0
}

/** 0 = 周日 … 6 = 周六 */
export function dayOfWeek(date: DateOnly): number {
  return makeUtcDate(parseDateOnly(date)).getUTCDay()
}

/**
 * 北京时间某日某时刻对应的 UTC 瞬时。
 * deadlineInstant('2026-10-01', '23:59') 即 2026-10-01T23:59+08:00 = 2026-10-01T15:59Z。
 */
export function cstInstantOf(date: DateOnly, timeOfDay = '00:00'): Date {
  const match = TIME_OF_DAY_PATTERN.exec(timeOfDay)
  if (!match) throw new Error(`不是合法的 HH:mm 时间：${timeOfDay}`)
  const { year, month, day } = parseDateOnly(date)
  const utcMs = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2])) - CST_OFFSET_MS
  return new Date(utcMs)
}

/** 该活动日的开放时刻 */
export function openInstant(date: DateOnly, dailyOpenTime: string): Date {
  return cstInstantOf(date, dailyOpenTime)
}

/** 该活动日的截止时刻 */
export function deadlineInstant(date: DateOnly, dailyDeadline: string): Date {
  return cstInstantOf(date, dailyDeadline)
}

export interface SubmissionWindow {
  open: Date
  deadline: Date
}

export function submissionWindow(
  date: DateOnly,
  dailyOpenTime: string,
  dailyDeadline: string,
): SubmissionWindow {
  return {
    open: openInstant(date, dailyOpenTime),
    deadline: deadlineInstant(date, dailyDeadline),
  }
}

export type WindowState = 'before_open' | 'open' | 'after_deadline'

export function windowState(date: DateOnly, dailyOpenTime: string, dailyDeadline: string, now: Date): WindowState {
  const window = submissionWindow(date, dailyOpenTime, dailyDeadline)
  if (now.getTime() < window.open.getTime()) return 'before_open'
  if (now.getTime() > window.deadline.getTime()) return 'after_deadline'
  return 'open'
}

/**
 * 判定是否仍可提交。
 * 管理员临时重新开放时传入 reopenExpiresAt，在时限内一律放行（design.md §8.5）。
 */
export function isSubmissionAllowed(params: {
  activityDate: DateOnly
  dailyOpenTime: string
  dailyDeadline: string
  now: Date
  reopenExpiresAt?: Date | null
}): boolean {
  const { activityDate, dailyOpenTime, dailyDeadline, now, reopenExpiresAt } = params

  const window = submissionWindow(activityDate, dailyOpenTime, dailyDeadline)
  // 重开只放宽截止，不能提前开放尚未开始的活动日
  if (reopenExpiresAt && now.getTime() <= reopenExpiresAt.getTime()) {
    return now.getTime() >= window.open.getTime()
  }

  const state = windowState(activityDate, dailyOpenTime, dailyDeadline, now)
  return state === 'open'
}

/** 把 UTC 瞬时格式化成活动日 + 北京时间，用于日志和导出 */
export function formatCstDateTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + CST_OFFSET_MS)
  return (
    `${formatUtcDate(shifted)} ` +
    `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
  )
}

/** 活动日列表（含首尾） */
export function enumerateDates(start: DateOnly, end: DateOnly): DateOnly[] {
  const dates: DateOnly[] = []
  let cursor = start
  while (compareDateOnly(cursor, end) <= 0) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}
