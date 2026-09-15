import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import { CSV_TEMPLATE_HEADERS, type ParticipantStatus } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { randomCode, randomToken, sha256Hex } from '../../core/crypto.js'
import { AppError, conflict, internalError, notFound, validationFailed } from '../../core/errors.js'
import { hashPassword, checkPasswordPolicy } from '../../core/password.js'
import { csvFormulaCast } from '../../core/text.js'
import { truncateToSecond } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { recordAudit, type AuditEntry } from '../../services/audit.service.js'
import { getStorage } from '../../storage/index.js'
import { LocalStorage } from '../../storage/local.js'
import { requireCurrentCampaign } from '../campaigns/service.js'
import { toPublicParticipant, type PublicParticipant } from '../users/serializer.js'

/**
 * 名单管理（design.md §7.1 账号激活、§8.3 名单管理）。
 *
 * 两条贯穿全文件的原则：
 *   1. 正式导入只认磁盘上暂存的原始文件，绝不采信客户端回传的解析结果（§7.1）；
 *   2. 激活码与密码明文只在生成它的那一次响应里出现，库里只有哈希（§13）。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** CSV 体积上限，与路由上 multer 的 fileSize 限制共用同一个值 */
export const CSV_MAX_BYTES = 5 * 1024 * 1024

/** 预览响应里回传的行数上限；summary 始终是精确值，只有明细会被截断 */
const PREVIEW_ROWS_LIMIT = 300

/** SQLite 单条语句的绑定变量个数有上限，IN 查询按此分批执行 */
const IN_CLAUSE_CHUNK = 500

/** 激活码导出只含状态，不含明文 —— 见 buildActivationCodesCsv 的说明 */
const ACTIVATION_CODE_EXPORT_HEADERS = [
  'student_id',
  'name',
  'class_name',
  'activation_code_status',
] as const

/** Excel 只有看到 BOM 才会按 UTF-8 解码，否则中文全部显示成乱码 */
const UTF8_BOM = '﻿'

const ACTIVATION_TOKEN_TTL_MS = env.activationTokenTtlDays * 24 * 60 * 60 * 1000

/** CSV 模板里必填的两列；其余列缺失时按空值处理 */
const REQUIRED_COLUMNS = ['student_id', 'name'] as const

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 审计上下文，由路由层的 auditContextFrom(req) 提供 */
export type ActorContext = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>

/** 从 CSV 中解析出的一行；不含任何校验结论 */
interface ParsedCsvRow {
  line: number
  studentId: string
  name: string
  className: string | null
  phoneSuffix: string | null
  remark: string | null
  /** 该行实际列数，用于识别字段错位的畸形行 */
  columnCount: number
}

/** 命中的已存在账号；existing 为 null 表示该学号是全新的 */
interface ExistingUser {
  id: string
  studentId: string
  name: string
  role: string
  status: string
  passwordHash: string | null
}

/** 校验后的一行；提交与预览共用同一份结论，避免两处判断漂移 */
interface ValidatedRow {
  row: ParsedCsvRow
  errors: string[]
  existing: ExistingUser | null
  /** 同一文件内该学号已出现过 */
  duplicateInFile: boolean
}

export interface ImportSummary {
  total: number
  valid: number
  invalid: number
  /** 学号在 users 表中已存在、提交时会走更新的行数 */
  existing_users: number
  /** 同一文件内重复出现（第二次及以后）的行数 */
  duplicates_in_file: number
}

export interface PreviewRow {
  line: number
  student_id: string
  name: string
  class_name: string | null
  status: 'ok' | 'error'
  errors: string[]
  /** 该学号已有账号，导入后会更新而不是新建 */
  existing: boolean
}

export interface PreviewImportResult {
  batch_id: string
  summary: ImportSummary
  rows: PreviewRow[]
  /** rows 是否因为超过 PREVIEW_ROWS_LIMIT 而被截断 */
  rows_truncated: boolean
}

export interface CommitImportResult {
  batch_id: string
  created: number
  updated: number
  skipped: number
  activation_codes: Array<{ student_id: string; name: string; activation_code: string }>
}

/**
 * 已存在的参赛记录中参与「是否需要更新」比对的字段。
 * 快照列在库中可空（历史数据可能没写快照），因此这里按可空处理。
 */
interface ParticipantSnapshot {
  id: string
  studentIdSnapshot: string | null
  nameSnapshot: string | null
  className: string | null
  phoneSuffix: string | null
  remark: string | null
}

/** 名单接口需要的关联字段：账号状态与「是否已激活」都来自 users */
interface ParticipantRowShape {
  id: string
  userId: string
  className: string | null
  phoneSuffix: string | null
  remark: string | null
  status: string
  joinedAt: Date
  user: { studentId: string; name: string; status: string; passwordHash: string | null }
}

export interface PublicAdminParticipant extends PublicParticipant {
  phone_suffix: string | null
  remark: string | null
  /** 是否已设置过密码；区别于 account_status（可能已激活但被禁用） */
  activated: boolean
}

export const ACTIVATION_CODE_STATUSES = ['未使用', '已使用', '已过期', '无'] as const
export type ActivationCodeStatus = (typeof ACTIVATION_CODE_STATUSES)[number]

// ---------------------------------------------------------------------------
// CSV 解析与校验（纯函数，预览与提交共用）
// ---------------------------------------------------------------------------

/** 去掉 BOM、确认编码，并把「不是 UTF-8」与「格式不对」区分开 */
function decodeCsv(buffer: Buffer): string {
  const text = buffer.toString('utf8')
  // Excel 默认按系统区域把 CSV 存成 GBK，按 UTF-8 解码会得到大量替换字符。
  // 与其让管理员看到「列数不一致」这种误导性报错，不如直接点明编码问题。
  if (text.includes('�')) {
    throw validationFailed('文件不是 UTF-8 编码，请在 Excel 中另存为「CSV UTF-8（逗号分隔）」后重试')
  }
  return text
}

interface ParsedCsv {
  headerCount: number
  rows: ParsedCsvRow[]
}

function parseCsv(text: string): ParsedCsv {
  let records: Array<{ record: string[]; info: { lines: number } }>
  try {
    // csv-parse 在 info: true 时返回的是 { record, info } 包装对象，
    // 而类型声明描述的是 columns 模式下的结果，这里按实际形状显式标注。
    records = parse(text, {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      trim: true,
      // 列数不一致的行由下面逐行报错，而不是让整个解析直接中断 ——
      // 一次只报一个错会让管理员反复试错
      relax_column_count: true,
      info: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number } }>
  } catch (error) {
    throw validationFailed('CSV 解析失败，请确认文件格式与模板一致', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  const header = records[0]?.record ?? []
  if (records.length === 0 || header.length === 0) {
    throw validationFailed('CSV 文件为空，请先下载模板再填写名单')
  }

  // 表头统一小写去空格，容忍 Excel 自动把首字母大写的情况
  const columnIndex = new Map<string, number>()
  header.forEach((raw, index) => {
    const key = raw.trim().toLowerCase()
    if (key.length > 0 && !columnIndex.has(key)) columnIndex.set(key, index)
  })

  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column))
  if (missing.length > 0) {
    throw validationFailed(`CSV 缺少必需列：${missing.join('、')}`, { missing_columns: missing })
  }

  const valueAt = (record: string[], column: string): string => {
    const index = columnIndex.get(column)
    if (index === undefined) return ''
    return (record[index] ?? '').trim()
  }
  const optionalAt = (record: string[], column: string): string | null => valueAt(record, column) || null

  const rows = records.slice(1).map(({ record, info }) => ({
    line: info.lines,
    studentId: valueAt(record, 'student_id'),
    name: valueAt(record, 'name'),
    className: optionalAt(record, 'class_name'),
    phoneSuffix: optionalAt(record, 'phone_suffix'),
    remark: optionalAt(record, 'remark'),
    columnCount: record.length,
  }))

  return { headerCount: header.length, rows }
}

export const DUPLICATE_IN_FILE_ERROR = '文件内学号重复'
const MALFORMED_COLUMN_ERROR = '列数与表头不一致'
const NON_PARTICIPANT_ERROR = '该学号已被管理员或审核员账号占用'

/**
 * 逐行校验。返回值同时供预览展示和正式导入使用 ——
 * 两处用同一个函数，才能保证「预览说没问题」和「导入真的没问题」是同一件事。
 */
export function validateRows(
  rows: ParsedCsvRow[],
  expectedColumns: number,
  existingByStudentId: Map<string, ExistingUser>,
): ValidatedRow[] {
  const seen = new Set<string>()

  return rows.map((row) => {
    const errors: string[] = []
    let duplicateInFile = false

    if (row.columnCount !== expectedColumns) {
      // 列数不对意味着字段已经整体错位，继续按列名取值只会产生一连串误导性报错，
      // 因此这里只报列数问题，不再深入校验字段内容。
      errors.push(`${MALFORMED_COLUMN_ERROR}（该行 ${row.columnCount} 列，表头 ${expectedColumns} 列）`)
    } else {
      if (!row.studentId) errors.push('学号不能为空')
      if (!row.name) errors.push('姓名不能为空')

      if (row.studentId) {
        if (seen.has(row.studentId)) {
          duplicateInFile = true
          errors.push(DUPLICATE_IN_FILE_ERROR)
        } else {
          seen.add(row.studentId)
        }
      }
    }

    const existing = row.studentId.length > 0 ? existingByStudentId.get(row.studentId) ?? null : null

    // 学号被管理员/审核员账号占用时必须拦下：否则 upsert 会把超管账号拉进参赛名单，
    // 同时把对方的姓名改写成名单上的名字。
    if (existing && existing.role !== 'participant') {
      errors.push(NON_PARTICIPANT_ERROR)
    }

    return { row, errors, existing, duplicateInFile }
  })
}

function summarize(validated: ValidatedRow[]): ImportSummary {
  let valid = 0
  let invalid = 0
  let existingUsers = 0
  let duplicates = 0

  for (const item of validated) {
    if (item.errors.length === 0) valid += 1
    else invalid += 1
    if (item.existing) existingUsers += 1
    if (item.duplicateInFile) duplicates += 1
  }

  return {
    total: validated.length,
    valid,
    invalid,
    existing_users: existingUsers,
    duplicates_in_file: duplicates,
  }
}

function toPreviewRow(item: ValidatedRow): PreviewRow {
  return {
    line: item.row.line,
    student_id: item.row.studentId,
    name: item.row.name,
    class_name: item.row.className,
    status: item.errors.length === 0 ? 'ok' : 'error',
    errors: item.errors,
    existing: item.existing !== null,
  }
}

// ---------------------------------------------------------------------------
// 查询辅助
// ---------------------------------------------------------------------------

function chunk<T>(items: T[], size = IN_CLAUSE_CHUNK): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/** 按学号批量加载已存在的账号；一次导入上千行时只发常数条查询 */
async function loadExistingUsers(db: Db, studentIds: string[]): Promise<Map<string, ExistingUser>> {
  const unique = [...new Set(studentIds.filter((id) => id.length > 0))]
  const found = new Map<string, ExistingUser>()

  for (const batch of chunk(unique)) {
    const users = await db.user.findMany({
      where: { studentId: { in: batch } },
      select: { id: true, studentId: true, name: true, role: true, status: true, passwordHash: true },
    })
    for (const user of users) found.set(user.studentId, user)
  }

  return found
}

/** 批量取回新建账号的 id，供激活码按 userId 写入 */
async function loadUserIdsByStudentId(db: Db, studentIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  for (const batch of chunk(studentIds)) {
    const users = await db.user.findMany({
      where: { studentId: { in: batch } },
      select: { id: true, studentId: true },
    })
    for (const user of users) found.set(user.studentId, user.id)
  }

  return found
}

/** 取当前活动下某个参赛者，附带账号信息 */
async function requireParticipantInCampaign(db: Db, campaignId: string, participantId: string) {
  const participant = await db.campaignParticipant.findFirst({
    where: { id: participantId, campaignId },
    include: {
      user: { select: { studentId: true, name: true, status: true, passwordHash: true } },
    },
  })
  if (!participant) throw notFound('参赛者不存在或不属于当前活动')
  return participant
}

export function toAdminParticipant(participant: ParticipantRowShape): PublicAdminParticipant {
  return {
    // 复用 users 模块的序列化，保证两个入口给出的 participants 形状一致
    ...toPublicParticipant(participant),
    phone_suffix: participant.phoneSuffix,
    remark: participant.remark,
    // 有密码哈希就说明走过激活流程；被禁用不等于未激活
    activated: participant.user.passwordHash !== null,
  }
}

// ---------------------------------------------------------------------------
// 存储辅助
// ---------------------------------------------------------------------------

/**
 * 临时区（putTmp / readTmp）目前只有本机存储实现。
 * Storage 接口是面向将来对象存储的抽象，这里显式收窄，
 * 换实现时会在调用点直接暴露，而不是悄悄把文件写到错误的位置。
 */
function requireLocalStorage(): LocalStorage {
  const storage = getStorage()
  if (!(storage instanceof LocalStorage)) {
    throw internalError('当前存储实现不支持名单暂存')
  }
  return storage
}

// ---------------------------------------------------------------------------
// 预览（design.md §7.1：导入前显示校验结果，管理员确认后才正式写入）
// ---------------------------------------------------------------------------

export async function previewImport(params: {
  buffer: Buffer
  fileName: string | null
  actor: ActorContext
}): Promise<PreviewImportResult> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)

  const parsed = parseCsv(decodeCsv(params.buffer))
  const existing = await loadExistingUsers(
    prisma,
    parsed.rows.map((row) => row.studentId),
  )
  const validated = validateRows(parsed.rows, parsed.headerCount, existing)
  const summary = summarize(validated)

  // 原始字节先落盘：正式导入时重新解析这一份，而不是客户端回传的解析结果（§7.1）
  const stagedPath = await requireLocalStorage().putTmp(params.fileName ?? 'participants.csv', params.buffer)

  const batch = await prisma.importBatch.create({
    data: {
      campaignId: campaign.id,
      fileSha256: sha256Hex(params.buffer),
      stagedPath,
      fileName: params.fileName,
      status: 'previewed',
      summary: JSON.stringify(summary),
      createdBy: params.actor.actorId,
    },
    select: { id: true },
  })

  await recordAudit({
    ...params.actor,
    action: 'participant.import.preview',
    targetType: 'import_batch',
    targetId: batch.id,
    after: { file_name: params.fileName, file_sha256: sha256Hex(params.buffer), summary },
  })

  return {
    batch_id: batch.id,
    summary,
    rows: validated.slice(0, PREVIEW_ROWS_LIMIT).map(toPreviewRow),
    rows_truncated: validated.length > PREVIEW_ROWS_LIMIT,
  }
}

// ---------------------------------------------------------------------------
// 正式导入
// ---------------------------------------------------------------------------

function parseStoredSummary(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** CampaignParticipant 上随名单变化的字段；status 刻意不在其中（见提交逻辑的注释） */
function participantFields(row: ParsedCsvRow) {
  return {
    studentIdSnapshot: row.studentId,
    nameSnapshot: row.name,
    className: row.className,
    phoneSuffix: row.phoneSuffix,
    remark: row.remark,
  }
}

export async function commitImport(params: {
  batchId: string
  actor: ActorContext
}): Promise<CommitImportResult> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()

  const batch = await prisma.importBatch.findUnique({ where: { id: params.batchId } })
  if (!batch) throw notFound('导入批次不存在')

  // 一个批次只能提交一次：重复提交会重复发放激活码
  if (batch.status !== 'previewed') {
    throw conflict('IMPORT_ALREADY_COMMITTED', `该批次已提交过（当前状态：${batch.status}），请重新上传名单`)
  }

  // 重新读取暂存文件并重新解析，任何客户端提供的行数据都不参与写入
  let buffer: Buffer
  try {
    buffer = await requireLocalStorage().readTmp(batch.stagedPath)
  } catch (error) {
    if (error instanceof AppError) throw error
    // 暂存区被 §14 的清理任务回收，或文件被手工删除
    throw new AppError('UPLOAD_INVALID', '暂存的名单文件已失效，请重新上传并预览')
  }

  if (sha256Hex(buffer) !== batch.fileSha256) {
    throw new AppError('UPLOAD_INVALID', '暂存的名单文件内容已变更，请重新上传并预览')
  }

  const parsed = parseCsv(decodeCsv(buffer))

  const committed = await runInTransaction(prisma, async (tx) => {
    const campaign = await requireCurrentCampaign(tx)

    const existing = await loadExistingUsers(
      tx,
      parsed.rows.map((row) => row.studentId),
    )
    const validated = validateRows(parsed.rows, parsed.headerCount, existing)
    const validRows = validated.filter((item) => item.errors.length === 0)
    const newRows = validRows.filter((item) => item.existing === null)

    // ---- 1. 新建账号：一次批量插入，避免上千次往返 ----
    if (newRows.length > 0) {
      await tx.user.createMany({
        data: newRows.map((item) => ({
          studentId: item.row.studentId,
          name: item.row.name,
          role: 'participant',
          // 尚未设置密码，必须等本人用激活码完成首次激活（§7.1）
          status: 'pending_activation',
        })),
      })
    }

    const createdUserIds = await loadUserIdsByStudentId(
      tx,
      newRows.map((item) => item.row.studentId),
    )

    /** 每个有效行对应的账号 id，后续写参赛记录与激活码都要用 */
    const userIdOf = (item: ValidatedRow): string => {
      const userId = item.existing ? item.existing.id : createdUserIds.get(item.row.studentId)
      if (!userId) throw internalError('导入过程中账号标识丢失，请重试')
      return userId
    }

    // ---- 2. 已有账号：只在姓名确实变化时更新，且绝不触碰角色、状态与密码 ----
    // 管理员可能已经手工禁用了某个账号，或本人已经改过密码，重新导入名单不该把这些覆盖掉。
    for (const item of validRows) {
      const current = item.existing
      if (!current || current.role !== 'participant') continue
      if (current.name === item.row.name) continue
      await tx.user.update({ where: { id: current.id }, data: { name: item.row.name } })
    }

    // ---- 3. 参赛记录：本活动已有的行做更新，其余批量插入 ----
    const userIds = validRows.map(userIdOf)
    const existingParticipants = new Map<string, ParticipantSnapshot>()
    for (const batchOfIds of chunk(userIds)) {
      const rows = await tx.campaignParticipant.findMany({
        where: { campaignId: campaign.id, userId: { in: batchOfIds } },
        select: {
          id: true,
          userId: true,
          studentIdSnapshot: true,
          nameSnapshot: true,
          className: true,
          phoneSuffix: true,
          remark: true,
        },
      })
      for (const row of rows) {
        existingParticipants.set(row.userId, {
          id: row.id,
          studentIdSnapshot: row.studentIdSnapshot,
          nameSnapshot: row.nameSnapshot,
          className: row.className,
          phoneSuffix: row.phoneSuffix,
          remark: row.remark,
        })
      }
    }

    const toCreate = validRows.filter((item) => !existingParticipants.has(userIdOf(item)))
    if (toCreate.length > 0) {
      await tx.campaignParticipant.createMany({
        data: toCreate.map((item) => ({
          campaignId: campaign.id,
          userId: userIdOf(item),
          ...participantFields(item.row),
        })),
      })
    }

    for (const item of validRows) {
      const current = existingParticipants.get(userIdOf(item))
      if (!current) continue

      const next = participantFields(item.row)
      // 逐行更新只写真正变化的行：重复导入同一份名单时几乎不产生写入
      if (
        current.studentIdSnapshot === next.studentIdSnapshot &&
        current.nameSnapshot === next.nameSnapshot &&
        current.className === next.className &&
        current.phoneSuffix === next.phoneSuffix &&
        current.remark === next.remark
      ) {
        continue
      }
      // 注意这里不写 status：管理员手工禁用的参赛者不能因为重新导入而被悄悄启用（§8.3）
      await tx.campaignParticipant.update({ where: { id: current.id }, data: next })
    }

    // ---- 4. 为新账号发放一次性激活码：库里只存哈希，明文仅出现在本次响应中 ----
    const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS)
    const issued = new Set<string>()
    const activationCodes = newRows.map((item) => {
      let code = randomCode()
      // token_hash 上有唯一约束，同一批次内也必须保证不撞码
      while (issued.has(code)) code = randomCode()
      issued.add(code)
      return { userId: userIdOf(item), studentId: item.row.studentId, name: item.row.name, code }
    })

    if (activationCodes.length > 0) {
      await tx.activationToken.createMany({
        data: activationCodes.map((item) => ({
          userId: item.userId,
          tokenHash: sha256Hex(item.code),
          expiresAt,
        })),
      })
    }

    // ---- 5. 标记批次已提交 ----
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: 'committed', committedAt: new Date() },
    })

    const created = newRows.length
    // 有效行里除去新建的就是更新；已有参赛记录的行可能什么都没变，但仍是「已存在」
    const updated = validRows.length - created
    const skipped = validated.length - validRows.length

    await recordAudit(
      {
        ...params.actor,
        action: 'participant.import.commit',
        targetType: 'import_batch',
        targetId: batch.id,
        before: { status: batch.status, summary: parseStoredSummary(batch.summary) },
        after: {
          status: 'committed',
          campaign_id: campaign.id,
          created,
          updated,
          skipped,
          // 只记数量，激活码明文不得进入审计日志（§13）
          activation_codes_issued: activationCodes.length,
        },
      },
      tx,
    )

    return { created, updated, skipped, activationCodes }
  })

  return {
    batch_id: batch.id,
    created: committed.created,
    updated: committed.updated,
    skipped: committed.skipped,
    activation_codes: committed.activationCodes.map((item) => ({
      student_id: item.studentId,
      name: item.name,
      activation_code: item.code,
    })),
  }
}

// ---------------------------------------------------------------------------
// 名单查询
// ---------------------------------------------------------------------------

export async function listParticipants(params: {
  status?: ParticipantStatus
  className?: string
  keyword?: string
  skip: number
  take: number
}): Promise<{ items: PublicAdminParticipant[]; total: number }> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)

  const where = {
    campaignId: campaign.id,
    ...(params.status ? { status: params.status } : {}),
    ...(params.className ? { className: params.className } : {}),
    // 关键字同时匹配学号与姓名；SQLite 的 LIKE 对 ASCII 天然不区分大小写
    ...(params.keyword
      ? {
          user: {
            OR: [{ studentId: { contains: params.keyword } }, { name: { contains: params.keyword } }],
          },
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.campaignParticipant.findMany({
      where,
      include: {
        user: { select: { studentId: true, name: true, status: true, passwordHash: true } },
      },
      // 按学号排序，管理员核对纸质名单时顺序稳定
      orderBy: { user: { studentId: 'asc' } },
      skip: params.skip,
      take: params.take,
    }),
    prisma.campaignParticipant.count({ where }),
  ])

  return { items: items.map(toAdminParticipant), total }
}

// ---------------------------------------------------------------------------
// 单个参赛者维护（§8.3）
// ---------------------------------------------------------------------------

/** 重新发放激活码前先作废旧码 */
async function replaceActivationToken(tx: Db, userId: string): Promise<{ code: string; expiresAt: Date }> {
  // 删除而不是标记 usedAt：activation-codes.csv 用 usedAt 判断「已使用」，
  // 把作废的码标成已使用会让导出结果说谎。
  await tx.activationToken.deleteMany({ where: { userId, usedAt: null } })

  const code = randomCode()
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS)
  await tx.activationToken.create({
    data: { userId, tokenHash: sha256Hex(code), expiresAt },
  })

  return { code, expiresAt }
}

export async function createParticipant(params: {
  studentId: string
  name: string
  className: string | null
  phoneSuffix: string | null
  remark: string | null
  actor: ActorContext
}): Promise<{ participant: PublicAdminParticipant; activation_code: string }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)

  const result = await runInTransaction(prisma, async (tx) => {
    const existing = await tx.user.findUnique({
      where: { studentId: params.studentId },
      select: { id: true, role: true, name: true },
    })

    if (existing && existing.role !== 'participant') {
      throw conflict('DUPLICATE_RECORD', '该学号已被管理员或审核员账号占用')
    }

    let userId: string
    if (existing) {
      userId = existing.id
      if (existing.name !== params.name) {
        await tx.user.update({ where: { id: existing.id }, data: { name: params.name } })
      }
      const joined = await tx.campaignParticipant.findUnique({
        where: { campaignId_userId: { campaignId: campaign.id, userId: existing.id } },
        select: { id: true },
      })
      if (joined) throw conflict('DUPLICATE_RECORD', '该学号已在当前活动的名单中')
    } else {
      const created = await tx.user.create({
        data: {
          studentId: params.studentId,
          name: params.name,
          role: 'participant',
          status: 'pending_activation',
        },
        select: { id: true },
      })
      userId = created.id
    }

    const participant = await tx.campaignParticipant.create({
      data: {
        campaignId: campaign.id,
        userId,
        studentIdSnapshot: params.studentId,
        nameSnapshot: params.name,
        className: params.className,
        phoneSuffix: params.phoneSuffix,
        remark: params.remark,
      },
      select: { id: true },
    })

    const { code } = await replaceActivationToken(tx, userId)

    await recordAudit(
      {
        ...params.actor,
        action: 'participant.create',
        targetType: 'campaign_participant',
        targetId: participant.id,
        after: {
          student_id: params.studentId,
          class_name: params.className,
          account_created: !existing,
        },
      },
      tx,
    )

    return { participantId: participant.id, code }
  })

  const full = await requireParticipantInCampaign(prisma, campaign.id, result.participantId)
  return { participant: toAdminParticipant(full), activation_code: result.code }
}

export async function updateParticipantStatus(params: {
  participantId: string
  status: 'active' | 'disabled'
  actor: ActorContext
}): Promise<{ participant: PublicAdminParticipant; revoked_sessions: number }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const participant = await requireParticipantInCampaign(prisma, campaign.id, params.participantId)

  const revokedSessions = await runInTransaction(prisma, async (tx) => {
    let revoked = 0
    let nextAccountStatus = participant.user.status

    if (params.status === 'disabled') {
      await tx.user.update({
        where: { id: participant.userId },
        data: { status: 'disabled', disabledAt: new Date() },
      })
      // 禁用必须立刻生效：撤销全部刷新会话，否则旧令牌还能换到新的访问令牌（§7.2）
      const result = await tx.refreshSession.updateMany({
        where: { userId: participant.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      revoked = result.count
      nextAccountStatus = 'disabled'
    } else {
      // 只解除禁用，不凭空激活：从未设置过密码的账号要退回 pending_activation，
      // 否则会出现「登录成功但每个接口都报未激活」的死状态。
      const user = await tx.user.findUnique({
        where: { id: participant.userId },
        select: { status: true, passwordHash: true },
      })
      if (user?.status === 'disabled') {
        nextAccountStatus = user.passwordHash ? 'active' : 'pending_activation'
        await tx.user.update({
          where: { id: participant.userId },
          data: { status: nextAccountStatus, disabledAt: null },
        })
      }
    }

    await tx.campaignParticipant.update({
      where: { id: participant.id },
      data: { status: params.status },
    })

    await recordAudit(
      {
        ...params.actor,
        action: 'participant.status.update',
        targetType: 'campaign_participant',
        targetId: participant.id,
        before: {
          participant_status: participant.status,
          account_status: participant.user.status,
        },
        after: {
          participant_status: params.status,
          account_status: nextAccountStatus,
          revoked_sessions: revoked,
        },
      },
      tx,
    )

    return revoked
  })

  const full = await requireParticipantInCampaign(prisma, campaign.id, participant.id)
  return { participant: toAdminParticipant(full), revoked_sessions: revokedSessions }
}

export async function regenerateActivationCode(params: {
  participantId: string
  actor: ActorContext
}): Promise<{ participant: PublicAdminParticipant; activation_code: string }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const participant = await requireParticipantInCampaign(prisma, campaign.id, params.participantId)

  const code = await runInTransaction(prisma, async (tx) => {
    const { code: regenerated } = await replaceActivationToken(tx, participant.userId)

    await recordAudit(
      {
        ...params.actor,
        action: 'participant.activation_code.regenerate',
        targetType: 'campaign_participant',
        targetId: participant.id,
        after: { student_id: participant.user.studentId, previous_codes_invalidated: true },
      },
      tx,
    )

    return regenerated
  })

  const full = await requireParticipantInCampaign(prisma, campaign.id, participant.id)
  return { participant: toAdminParticipant(full), activation_code: code }
}

/**
 * 生成符合密码策略的初始密码。
 * 反复调用 randomToken 直到通过 checkPasswordPolicy —— base64url 字母表本身含字母与数字，
 * 一般一次就通过；直接拼字符串更容易在「保证含数字」这类要求上出错。
 */
function generateResetPassword(): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = randomToken(12)
    if (checkPasswordPolicy(candidate).ok) return candidate
  }
  // 连续 16 次都不满足策略的概率可以忽略，走到这里说明随机源出了问题
  throw internalError('无法生成符合密码策略的临时密码')
}

export async function resetParticipantPassword(params: {
  participantId: string
  actor: ActorContext
}): Promise<{ participant: PublicAdminParticipant; password: string }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)
  const participant = await requireParticipantInCampaign(prisma, campaign.id, params.participantId)

  // 没有邮箱，只能由管理员生成一次性密码当面/私下转交（§7.2）
  const password = generateResetPassword()
  const passwordHash = await hashPassword(password)
  const passwordChangedAt = truncateToSecond(new Date())

  await runInTransaction(prisma, async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: participant.userId },
      select: { status: true },
    })

    await tx.user.update({
      where: { id: participant.userId },
      data: {
        passwordHash,
        passwordChangedAt,
        // 管理员直接发了密码，等于替对方完成了首次激活；
        // 不改成 active 的话会出现「能登录但所有接口报未激活」的死状态。
        // 已禁用的账号保持禁用，解禁仍需管理员显式操作。
        ...(before?.status === 'pending_activation' ? { status: 'active' } : {}),
      },
    })

    // 重置密码后旧会话全部失效（§7.2）
    await tx.refreshSession.updateMany({
      where: { userId: participant.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    await recordAudit(
      {
        ...params.actor,
        action: 'participant.password.reset',
        targetType: 'campaign_participant',
        targetId: participant.id,
        // 明文与哈希都不进审计（§13）
        after: { student_id: participant.user.studentId, password_changed_at: passwordChangedAt },
      },
      tx,
    )
  })

  const full = await requireParticipantInCampaign(prisma, campaign.id, participant.id)
  return { participant: toAdminParticipant(full), password }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

function withBom(csv: string): string {
  return `${UTF8_BOM}${csv}`
}

/**
 * 激活码只保存哈希，明文在生成那一刻之后就无法还原。
 * 因此导出只能报告「有没有可用的码」和「有没有被用过」，不可能导出明文激活码 ——
 * 需要明文时只能用 /:participantId/activation-code 重新生成一个。
 */
export function describeActivationCodeStatus(
  tokens: Array<{ usedAt: Date | null; expiresAt: Date }>,
  now: Date = new Date(),
): ActivationCodeStatus {
  if (tokens.length === 0) return '无'
  // 账号一旦激活，「已使用」是最有意义的事实，优先于其它未使用的码
  if (tokens.some((token) => token.usedAt !== null)) return '已使用'
  if (tokens.some((token) => token.expiresAt.getTime() > now.getTime())) return '未使用'
  return '已过期'
}

/** CSV 模板：只输出表头 */
export function buildTemplateCsv(): string {
  // 不放示例行：管理员忘了删示例就会被当成真实名单导入
  return withBom(stringify([], { header: true, columns: [...CSV_TEMPLATE_HEADERS], ...csvFormulaCast }))
}

export async function buildActivationCodesCsv(): Promise<string> {
  const prisma = getPrismaClient()
  const campaign = await requireCurrentCampaign(prisma)

  const participants = await prisma.campaignParticipant.findMany({
    where: { campaignId: campaign.id },
    include: {
      user: {
        select: {
          studentId: true,
          name: true,
          activationTokens: { select: { usedAt: true, expiresAt: true } },
        },
      },
    },
    orderBy: { user: { studentId: 'asc' } },
  })

  const records = participants.map((participant) => ({
    student_id: participant.user.studentId,
    name: participant.user.name,
    class_name: participant.className ?? '',
    activation_code_status: describeActivationCodeStatus(participant.user.activationTokens),
  }))

  return withBom(stringify(records, { header: true, columns: [...ACTIVATION_CODE_EXPORT_HEADERS], ...csvFormulaCast }))
}
