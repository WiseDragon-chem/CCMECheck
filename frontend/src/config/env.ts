/**
 * 前端只需要一个环境变量。
 *
 * 开发环境留空（走 Vite 代理，与后端同源）；生产环境同样应保持同源 ——
 * 见 README 的部署约束：刷新令牌是 SameSite=Lax 的 Cookie，
 * 前后端若跨站，静默刷新会永久失败。
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

/** 活动日与时间戳的展示时区，固定北京时间（中国不实行夏令时） */
export const DISPLAY_UTC_OFFSET_HOURS = 8
