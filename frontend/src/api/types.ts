import type { components } from '@/types/api'

/**
 * 从生成的 OpenAPI 契约里取出常用类型。
 *
 * 这里是唯一给契约类型起别名的地方 —— 业务代码一律从这里 import，
 * 不直接写 `components['schemas']['X']`，这样将来契约结构调整时只需改一处。
 */
export type Schemas = components['schemas']

export type PublicUser = Schemas['User']
export type AuthResponse = Schemas['AuthResponse']
export type Campaign = Schemas['Campaign']
export type Track = Schemas['Track']
export type CampaignCurrent = Schemas['CampaignCurrentResponse']

export type TodayOverview = Schemas['TodayOverview']
export type TodayCard = Schemas['TodayCard']
export type CardState = TodayCard['card_state']

export type CheckinList = Schemas['CheckinListResponse']
export type CheckinListItem = Schemas['CheckinListItem']
export type CheckinDetail = Schemas['CheckinDetail']
export type SubmitCheckinResult = Schemas['SubmitCheckinResponse']
export type SignedAssetUrl = Schemas['SignedAssetUrl']

export type Leaderboard = Schemas['LeaderboardResponse']
export type LeaderboardRow = Schemas['LeaderboardRow']

// ---- 管理后台 ----

export type DashboardStats = Schemas['DashboardStats']
export type DashboardWarning = DashboardStats['warnings'][number]
export type TrackStat = DashboardStats['tracks'][number]

export type AdminCampaignConfig = Schemas['CampaignConfigResponse']

export type AdminParticipant = Schemas['AdminParticipant']
export type AdminParticipantList = Schemas['AdminParticipantListResponse']

export type ReviewQueue = Schemas['ReviewQueueResponse']
export type ReviewQueueEntry = Schemas['ReviewQueueEntry']
export type ReviewProgress = Schemas['ReviewProgress']
export type ReviewEntryDetail = Schemas['ReviewEntryDetail']
export type ReviewResult = Schemas['ReviewResult']
export type ReviewAction = ReviewEntryDetail['history']['review_actions'][number]
export type RejectReason = Schemas['RejectReason']
export type RejectReasonCode = RejectReason['code']

export type EntryState = Schemas['EntryState']
export type ReopenEntryResult = Schemas['ReopenEntryResult']
export type ManualEntry = Schemas['ManualEntry']
export type ScoreAdjustment = Schemas['ScoreAdjustment']

export type ScheduledJob = Schemas['ScheduledJob']
export type JobRun = Schemas['JobRun']
export type JobTriggerResult = Schemas['JobTriggerResult']
export type JobStatus = JobRun['status']

export type AuditLogEntry = Schemas['AuditLogEntry']
export type AuditLogList = Schemas['AuditLogListResponse']

/** 各列表接口共用的分页字段 */
export type PaginationFields = Schemas['PaginationFields']

/**
 * 错误码联合类型，直接来自契约。
 *
 * 服务端把错误码目录写进了 OpenAPI（而不是一个宽泛的 string），
 * 因此下面的 ERROR_HANDLING 表能获得编译器强制的穷尽性检查：
 * 服务端新增一个错误码而这里没处理，编译就会失败。
 */
export type ErrorCode = Schemas['ErrorResponse']['code']
export type ErrorResponseBody = Schemas['ErrorResponse']
