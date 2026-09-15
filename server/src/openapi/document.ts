import { z } from 'zod'
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { REJECT_REASON_CODES } from '../config/constants.js'
import { activateBodySchema, changePasswordBodySchema, loginBodySchema } from '../modules/auth/schema.js'
import {
  createCampaignBodySchema,
  updateCampaignBodySchema,
  updateCampaignTrackBodySchema,
} from '../modules/campaigns/schema.js'
import { listCheckinsQuerySchema } from '../modules/checkins/schema.js'
import { latestLeaderboardQuerySchema, myRankQuerySchema } from '../modules/leaderboards/schema.js'
import { importCommitBodySchema, createParticipantBodySchema, updateParticipantStatusBodySchema } from '../modules/participants/schema.js'
import { approveReviewBodySchema, rejectReviewBodySchema, reviewQueueQuerySchema } from '../modules/reviews/schema.js'
import {
  createManualEntryBodySchema,
  createScoreAdjustmentBodySchema,
  reopenEntryBodySchema,
  revokeEntryBodySchema,
  voidEntryBodySchema,
} from '../modules/admin-ops/schema.js'
import {
  AuditLogEntrySchema,
  AuthResponseSchema,
  CampaignCurrentResponseSchema,
  CheckinDetailSchema,
  CheckinListResponseSchema,
  ErrorResponseSchema,
  JobRunSchema,
  LeaderboardResponseSchema,
  ParticipantSchema,
  RejectReasonSchema,
  ReviewQueueEntrySchema,
  SignedAssetUrlSchema,
  SubmitCheckinResponseSchema,
  TodayOverviewSchema,
  UserSchema,
  errorResponses,
} from './schemas.js'

/**
 * OpenAPI 文档（design.md 交付物之一）。
 *
 * 请求体直接引用各模块的 Zod schema —— 它们是运行时校验的同一份对象，
 * 因此文档与实现不可能各自漂移。响应体引用 schemas.ts 里的组件定义。
 */

const jsonBody = (schema: z.ZodType) => ({
  body: { content: { 'application/json': { schema } } },
})

const jsonResponse = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'application/json': { schema } },
})

const csvResponse = (description: string) => ({
  description: `${description}（UTF-8 带 BOM，CRLF 换行）`,
  content: { 'text/csv': { schema: z.string() } },
})

const idParams = z.object({ entryId: z.string() })
const participantParams = z.object({ participantId: z.string() })
const assetParams = z.object({ entryId: z.string(), assetId: z.string() })
const trackParams = z.object({ trackId: z.string() })
const jobParams = z.object({ name: z.string() })

const paginated = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(50).optional(),
})

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry()

  registry.register('ErrorResponse', ErrorResponseSchema)
  registry.register('User', UserSchema)
  registry.register('AuthResponse', AuthResponseSchema)
  registry.register('CampaignCurrentResponse', CampaignCurrentResponseSchema)
  registry.register('TodayOverview', TodayOverviewSchema)
  registry.register('CheckinListResponse', CheckinListResponseSchema)
  registry.register('CheckinDetail', CheckinDetailSchema)
  registry.register('SubmitCheckinResponse', SubmitCheckinResponseSchema)
  registry.register('SignedAssetUrl', SignedAssetUrlSchema)
  registry.register('LeaderboardResponse', LeaderboardResponseSchema)
  registry.register('Participant', ParticipantSchema)
  registry.register('ReviewQueueEntry', ReviewQueueEntrySchema)
  registry.register('AuditLogEntry', AuditLogEntrySchema)
  registry.register('JobRun', JobRunSchema)

  // -------------------------------------------------------------------------
  // 认证
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/activate',
    tags: ['认证'],
    summary: '使用学号与激活码激活账号',
    description:
      '激活码只保存哈希，成功使用后立即失效。名单外的学号无法激活，但错误信息不区分学号是否存在。' +
      '按 IP + 学号限流。',
    request: jsonBody(activateBodySchema),
    responses: {
      201: jsonResponse('激活成功，同时在 HttpOnly Cookie 中下发刷新令牌', AuthResponseSchema),
      ...errorResponses(400, 429),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/login',
    tags: ['认证'],
    summary: '登录',
    description: '连续失败会触发限流（按 IP + 学号双维度）。',
    request: jsonBody(loginBodySchema),
    responses: {
      200: jsonResponse('登录成功', AuthResponseSchema),
      ...errorResponses(400, 401, 429),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/refresh',
    tags: ['认证'],
    summary: '刷新访问令牌',
    description: '刷新令牌从 Cookie 读取，刷新时轮换 —— 旧刷新令牌立即失效。',
    responses: {
      200: jsonResponse('刷新成功', AuthResponseSchema),
      ...errorResponses(401, 429),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    tags: ['认证'],
    summary: '退出并撤销当前会话',
    description: '按 Cookie 中的刷新令牌撤销对应会话，不影响该账号的其他设备。',
    responses: { 204: { description: '已退出' } },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/change-password',
    tags: ['认证'],
    summary: '修改密码',
    description:
      '撤销改密之前存在的全部长期会话，并为当前设备补发一套新凭证。' +
      '签发时间早于改密时刻的访问令牌同样失效。',
    request: jsonBody(changePasswordBodySchema),
    responses: {
      200: jsonResponse('修改成功', AuthResponseSchema),
      ...errorResponses(400, 401),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/users/me',
    tags: ['认证'],
    summary: '获取当前用户',
    responses: {
      200: jsonResponse('当前用户', z.object({ user: UserSchema })),
      ...errorResponses(401),
    },
  })

  // -------------------------------------------------------------------------
  // 活动与打卡
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/api/v1/campaigns/current',
    tags: ['活动'],
    summary: '获取当前活动与赛道规则',
    responses: {
      200: jsonResponse('当前活动', CampaignCurrentResponseSchema),
      ...errorResponses(401, 409),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/checkins/today',
    tags: ['打卡'],
    summary: '今日三个赛道的卡片状态',
    description: 'design.md §7.3 的状态表；审核员与超管若非参赛者，cards 为空数组。',
    responses: {
      200: jsonResponse('今日概览', TodayOverviewSchema),
      ...errorResponses(401, 409),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/checkins',
    tags: ['打卡'],
    summary: '查询个人打卡记录',
    request: { query: listCheckinsQuerySchema },
    responses: {
      200: jsonResponse('记录列表（按活动日倒序）', CheckinListResponseSchema),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/checkins/{entryId}',
    tags: ['打卡'],
    summary: '查看打卡详情与历史版本',
    request: { params: idParams },
    responses: {
      200: jsonResponse('打卡详情', CheckinDetailSchema),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/checkins',
    tags: ['打卡'],
    summary: '创建或重新提交打卡',
    description:
      'multipart/form-data。重新提交产生新版本并保留历史，槽位不变。' +
      'client_token 是幂等键，用于防止重复点击产生重复版本。' +
      '已通过的记录参赛者不能自行修改，需管理员重新打开。',
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              track: z.string().openapi({ description: '赛道 slug，如 reading' }),
              activity_date: z.string().openapi({ example: '2026-10-01' }),
              note: z.string().optional(),
              client_token: z.string().optional().openapi({ description: '幂等键，建议每个提交动作生成一次' }),
              images: z.array(z.string().openapi({ format: 'binary' })).openapi({ description: '1–3 张证明材料' }),
            }),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('提交成功，状态为待审核', SubmitCheckinResponseSchema),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/checkins/{entryId}/assets/{assetId}',
    tags: ['打卡'],
    summary: '签发证明材料的短期访问地址',
    description: '签发前校验请求者身份：参赛者只能取自己的材料，审核员与超管可取全部。',
    request: { params: assetParams },
    responses: {
      200: jsonResponse('签名地址', SignedAssetUrlSchema),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/assets/{assetId}',
    tags: ['打卡'],
    summary: '凭签名取回图片字节',
    description:
      '**本端点不做会话认证** —— <img src> 无法携带 Bearer 令牌，签名本身就是短期能力凭证。' +
      '签名覆盖 assetId 与过期时间，任意一处被改动都会校验失败。',
    request: {
      params: z.object({ assetId: z.string() }),
      query: z.object({
        exp: z.string().openapi({ description: '过期时刻（Unix 秒）' }),
        uid: z.string().openapi({ description: '签发时对应的用户，用于审计追溯' }),
        sig: z.string().openapi({ description: 'HMAC-SHA256 签名' }),
      }),
    },
    responses: {
      200: {
        description: '图片字节',
        content: { 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      ...errorResponses(401, 404),
    },
  })

  // -------------------------------------------------------------------------
  // 排行榜
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/api/v1/leaderboards/latest',
    tags: ['排行榜'],
    summary: '获取最新排行榜快照',
    description: 'track 省略时返回总榜。排行榜不可见时仅管理角色可读。',
    request: { query: latestLeaderboardQuerySchema },
    responses: {
      200: jsonResponse('排行榜', LeaderboardResponseSchema),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/leaderboards/me',
    tags: ['排行榜'],
    summary: '获取当前用户排名与附近名次',
    request: { query: myRankQuerySchema },
    responses: {
      200: jsonResponse('我的排名', LeaderboardResponseSchema),
      ...errorResponses(401, 403),
    },
  })

  // -------------------------------------------------------------------------
  // 管理后台
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/dashboard',
    tags: ['管理后台'],
    summary: '首页统计与任务告警',
    description: 'design.md §8.1：参赛人数、今日提交/通过/驳回、各赛道提交率、下次排行榜更新时间、任务异常。',
    responses: {
      200: jsonResponse('统计信息', z.object({}).passthrough()),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/campaign',
    tags: ['管理后台'],
    summary: '读取活动配置',
    responses: {
      200: jsonResponse('活动与赛道', CampaignCurrentResponseSchema),
      ...errorResponses(401, 403, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/campaign',
    tags: ['管理后台'],
    summary: '新建活动',
    description: '新建的活动状态为 draft，需显式切换到 active 才会开放打卡。',
    request: jsonBody(createCampaignBodySchema),
    responses: {
      201: jsonResponse('创建成功', CampaignCurrentResponseSchema),
      ...errorResponses(400, 401, 403),
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/admin/campaign',
    tags: ['管理后台'],
    summary: '更新活动配置',
    description:
      '活动开始后修改日期或截止时间属于高风险操作：响应中的 impact_warning 会给出提示，' +
      '修改前后的值一并写入审计日志。需要 5 分钟内的新鲜认证。',
    request: jsonBody(updateCampaignBodySchema),
    responses: {
      200: jsonResponse('更新成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 409),
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/admin/campaign/tracks/{trackId}',
    tags: ['管理后台'],
    summary: '更新赛道计分规则',
    request: { params: trackParams, ...jsonBody(updateCampaignTrackBodySchema) },
    responses: {
      200: jsonResponse('更新成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/participants',
    tags: ['名单管理'],
    summary: '查询参赛者名单',
    responses: {
      200: jsonResponse('名单', z.object({ items: z.array(ParticipantSchema) }).passthrough()),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/participants',
    tags: ['名单管理'],
    summary: '添加单个参赛者',
    description: '返回的激活码明文只出现这一次，系统只保存其哈希。',
    request: jsonBody(createParticipantBodySchema),
    responses: {
      201: jsonResponse('添加成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 409),
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/admin/participants/{participantId}',
    tags: ['名单管理'],
    summary: '启用或禁用参赛者',
    description: '禁用会同时撤销该账号的所有登录会话，立即生效。',
    request: { params: participantParams, ...jsonBody(updateParticipantStatusBodySchema) },
    responses: {
      200: jsonResponse('更新成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/participants/{participantId}/activation-code',
    tags: ['名单管理'],
    summary: '重新生成激活码',
    description: '旧的一次性激活码会被删除，返回值中的明文只出现一次。',
    request: { params: participantParams },
    responses: {
      200: jsonResponse('新激活码', z.object({}).passthrough()),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/participants/{participantId}/reset-password',
    tags: ['名单管理'],
    summary: '重置密码',
    description: '首期没有绑定邮箱，忘记密码由管理员生成一次性重置码。会撤销该账号全部会话。',
    request: { params: participantParams },
    responses: {
      200: jsonResponse('新密码（只出现一次）', z.object({}).passthrough()),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/participants/template.csv',
    tags: ['名单管理'],
    summary: '下载名单模板',
    responses: { 200: csvResponse('CSV 模板') },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/participants/activation-codes.csv',
    tags: ['名单管理'],
    summary: '导出激活码状态',
    description: '激活码只保存哈希，因此这里只能给出「未使用 / 已使用 / 已过期 / 无」的状态，无法导出明文。',
    responses: { 200: csvResponse('激活码状态') },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/participants/import/preview',
    tags: ['名单管理'],
    summary: '校验并预览名单',
    description:
      'multipart/form-data，字段名为 file。只做校验不写库，原始 CSV 会落盘暂存，' +
      '提交时重新解析 —— 不信任客户端回传的解析结果。返回 batch_id 供 commit 使用。',
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({ file: z.string().openapi({ format: 'binary' }) }),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('预览结果', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/participants/import/commit',
    tags: ['名单管理'],
    summary: '正式导入名单',
    description: '整批在一个事务内写入；返回的激活码明文只出现一次。',
    request: jsonBody(importCommitBodySchema),
    responses: {
      200: jsonResponse('导入结果', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 409),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/reviews/queue',
    tags: ['审核'],
    summary: '获取待审核队列',
    description: '按提交时间升序（先进先出），并附带队列进度统计。',
    request: { query: reviewQueueQuerySchema },
    responses: {
      200: jsonResponse('队列', z.object({ entries: z.array(ReviewQueueEntrySchema) }).passthrough()),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/reviews/{entryId}',
    tags: ['审核'],
    summary: '获取审核详情',
    description: '审核页右侧面板所需：参赛者、赛道、活动日、提交时间、历史记录与审核操作。',
    request: { params: idParams },
    responses: {
      200: jsonResponse('详情', z.object({}).passthrough()),
      ...errorResponses(401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/reviews/{entryId}/approve',
    tags: ['审核'],
    summary: '审核通过',
    description:
      '必须回传审核者看到的 version。两名管理员同时操作时，后提交者会收到 409 REVIEW_CONFLICT，' +
      '刷新后重试即可。',
    request: { params: idParams, ...jsonBody(approveReviewBodySchema) },
    responses: {
      200: jsonResponse('已通过', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/reviews/{entryId}/reject',
    tags: ['审核'],
    summary: '审核驳回',
    description: '驳回必须填写原因。预设原因码见 RejectReason；选择 other 时必须补充文字说明。',
    request: { params: idParams, ...jsonBody(rejectReviewBodySchema) },
    responses: {
      200: jsonResponse('已驳回', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/reviews/reject-reasons',
    tags: ['审核'],
    summary: '获取预设驳回原因',
    responses: { 200: jsonResponse('预设原因', z.object({ reasons: z.array(RejectReasonSchema) })) },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/checkins/{entryId}/reopen',
    tags: ['异常处理'],
    summary: '临时重新开放打卡槽位',
    description:
      '带时限的重开。成功提交后时限即被消费，避免永久绕过每日截止校验。需要新鲜认证且必须填写原因。',
    request: { params: idParams, ...jsonBody(reopenEntryBodySchema) },
    responses: {
      200: jsonResponse('已重新开放', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/checkins/{entryId}/revoke',
    tags: ['异常处理'],
    summary: '撤销审核结果',
    description: '仅对已通过的记录有效。撤销后该记录不再计分。',
    request: { params: idParams, ...jsonBody(revokeEntryBodySchema) },
    responses: {
      200: jsonResponse('已撤销', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/checkins/{entryId}/void',
    tags: ['异常处理'],
    summary: '作废违规记录',
    description: '对任意状态均可作废（本身已是 void 的除外）。',
    request: { params: idParams, ...jsonBody(voidEntryBodySchema) },
    responses: {
      200: jsonResponse('已作废', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/checkins/manual',
    tags: ['异常处理'],
    summary: '管理员补录',
    description: '为指定参赛者在指定活动日补录一条记录，标记为人工录入。同一槽位已存在记录时会冲突。',
    request: jsonBody(createManualEntryBodySchema),
    responses: {
      201: jsonResponse('补录成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/score-adjustments',
    tags: ['异常处理'],
    summary: '积分调整',
    description:
      '只新增调整记录，**从不改写原始积分字段**（design.md §9.1）。' +
      '调整不受赛道积分上限约束，否则管理员加分会被上限静默吃掉。',
    request: jsonBody(createScoreAdjustmentBodySchema),
    responses: {
      201: jsonResponse('调整成功', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/leaderboards/rebuild',
    tags: ['排行榜'],
    summary: '重算排行榜',
    description: '同一活动、同一统计截止日期只会存在一份快照，重复执行是幂等的。',
    request: jsonBody(z.object({ cutoff_date: z.string().optional(), reason: z.string() })),
    responses: {
      200: jsonResponse('重算结果', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/leaderboards/freeze',
    tags: ['排行榜'],
    summary: '冻结最终榜单',
    description: '仍有待审核记录时会被拒绝，必须先清空队列。冻结后快照行永不被重写。',
    request: jsonBody(z.object({ cutoff_date: z.string().optional(), reason: z.string() })),
    responses: {
      200: jsonResponse('已冻结', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/leaderboards/unfreeze',
    tags: ['排行榜'],
    summary: '解冻榜单',
    request: jsonBody(z.object({ cutoff_date: z.string(), reason: z.string() })),
    responses: {
      200: jsonResponse('已解冻', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/exports/checkins.csv',
    tags: ['导出'],
    summary: '导出打卡明细',
    request: { query: listCheckinsQuerySchema },
    responses: { 200: csvResponse('打卡明细') },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/exports/leaderboard.csv',
    tags: ['导出'],
    summary: '导出排行榜',
    description: '积分与排行榜使用同一份计分引擎，因此导出结果与页面展示一致。',
    request: { query: z.object({ cutoff_date: z.string().optional() }) },
    responses: { 200: csvResponse('排行榜') },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/exports/participants.csv',
    tags: ['导出'],
    summary: '导出参赛者名册',
    responses: { 200: csvResponse('参赛者名册') },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/audit-logs',
    tags: ['管理后台'],
    summary: '查询审计日志',
    description: '只追加、只读。时间筛选按北京时间日期理解。',
    request: {
      query: paginated.extend({
        actor_id: z.string().optional(),
        action: z.string().optional(),
        target_type: z.string().optional(),
        target_id: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    },
    responses: {
      200: jsonResponse('审计日志（倒序）', z.object({ items: z.array(AuditLogEntrySchema) }).passthrough()),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/jobs/scheduled',
    tags: ['定时任务'],
    summary: '查看已注册的调度计划',
    responses: { 200: jsonResponse('调度计划', z.object({ jobs: z.array(z.object({}).passthrough()) })) },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/jobs/runs',
    tags: ['定时任务'],
    summary: '查询任务执行历史',
    request: {
      query: paginated.extend({
        job_name: z.string().optional(),
        status: z.enum(['running', 'success', 'failed', 'skipped_locked']).optional(),
      }),
    },
    responses: {
      200: jsonResponse('执行历史（倒序）', z.object({ items: z.array(JobRunSchema) }).passthrough()),
      ...errorResponses(401, 403),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/jobs/{name}/run',
    tags: ['定时任务'],
    summary: '手动触发任务',
    description: '与定时触发共用同一套互斥锁与执行记录。已被占用时返回 skipped_locked。',
    request: { params: jobParams },
    responses: {
      200: jsonResponse('执行结果', z.object({}).passthrough()),
      ...errorResponses(400, 401, 403, 404),
    },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CCME 国庆打卡平台 API',
      version: '0.1.0',
      description: [
        '北京大学化学与分子工程学院国庆打卡活动后端。',
        '',
        '**约定**',
        '- 所有路径以 `/api/v1` 为前缀，**请求体与响应字段一律 `snake_case`**（含认证接口）。',
        '- 访问令牌走 `Authorization: Bearer`；刷新令牌在 HttpOnly Cookie 中。',
        '- 积分以「毫点」为单位的整数传输（1000 = 1 分），权重为千分比整数。',
        '- 活动日按北京时间（固定 +08:00）计算；服务器时间以响应中的 `server_time` 为准，',
        '  前端倒计时只作展示。',
        '- 错误响应统一为 `{ code, message, request_id, details }`，请依据稳定的 `code` 分支。',
        '',
        `预设驳回原因：${REJECT_REASON_CODES.map((item) => `${item.code}（${item.label}）`).join('、')}`,
      ].join('\n'),
    },
    servers: [{ url: '/', description: '当前服务' }],
    tags: [
      { name: '认证', description: '激活、登录、刷新、改密' },
      { name: '活动', description: '活动信息与赛道规则' },
      { name: '打卡', description: '提交打卡与查看证明材料' },
      { name: '排行榜', description: '快照查询与重算、冻结' },
      { name: '管理后台', description: '首页统计、活动配置、审计日志' },
      { name: '名单管理', description: '名单导入与参赛者管理' },
      { name: '审核', description: '流水线审核' },
      { name: '异常处理', description: '补录、撤销、作废、积分调整' },
      { name: '导出', description: 'CSV 导出' },
      { name: '定时任务', description: '调度计划与执行历史' },
    ],
  })
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>
