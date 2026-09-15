import sharp from 'sharp'
import { DEFAULT_TRACKS, type UserRole } from '../../src/config/constants.js'
import { randomObjectKey, sha256Hex } from '../../src/core/crypto.js'
import { hashPassword } from '../../src/core/password.js'
import { truncateToSecond } from '../../src/core/time.js'
import { getPrismaClient, type Db } from '../../src/db/client.js'

/** 测试数据构造器。所有函数都直接写库，跳过 HTTP 层以便精确摆放前置状态。 */

export const TEST_PASSWORD = 'Passw0rd123'

export async function createTrack(slug: string, name?: string, sortOrder = 1, db: Db = getPrismaClient()) {
  return db.track.create({
    data: {
      slug,
      name: name ?? slug,
      description: `${name ?? slug} 测试赛道`,
      proofInstructions: `请上传 ${name ?? slug} 的证明材料`,
      sortOrder,
    },
  })
}

/** 建齐三个默认赛道（reading / vocabulary / fitness） */
export async function createDefaultTracks(db: Db = getPrismaClient()) {
  const tracks = []
  for (const track of DEFAULT_TRACKS) {
    tracks.push(
      await db.track.create({
        data: {
          slug: track.slug,
          name: track.name,
          description: track.description,
          icon: track.icon,
          proofInstructions: track.proofInstructions,
          sortOrder: track.sortOrder,
        },
      }),
    )
  }
  return tracks
}

export interface CreateUserOptions {
  studentId: string
  name?: string
  role?: UserRole
  /** 默认 active；传 pending_activation 可模拟未激活账号 */
  status?: 'pending_activation' | 'active' | 'disabled'
  password?: string | null
  capabilities?: string[]
  db?: Db
}

export async function createUser(options: CreateUserOptions) {
  const db = options.db ?? getPrismaClient()
  const status = options.status ?? 'active'
  const password = options.password === undefined ? TEST_PASSWORD : options.password

  return db.user.create({
    data: {
      studentId: options.studentId,
      name: options.name ?? `测试用户${options.studentId}`,
      role: options.role ?? 'participant',
      status,
      passwordHash: password === null ? null : await hashPassword(password),
      // 截断到秒：JWT 的 iat 只有秒级精度，带毫秒会让随后签发的令牌被判为「过期」
      passwordChangedAt: password === null ? null : truncateToSecond(new Date()),
      capabilities: JSON.stringify(options.capabilities ?? []),
    },
  })
}

export interface CreateCampaignOptions {
  name?: string
  startDate: string
  endDate: string
  dailyOpenTime?: string
  dailyDeadline?: string
  status?: string
  leaderboardVisible?: boolean
  leaderboardTime?: string
  nameDisplayMode?: string
  minImages?: number
  maxImages?: number
  maxImageBytes?: number
  /** 按赛道 slug 覆盖计分规则 */
  trackConfig?: Record<string, { dailyPoints?: number; dailyCap?: number | null; campaignCap?: number | null; overallWeight?: number; enabled?: boolean }>
  db?: Db
}

export async function createCampaign(options: CreateCampaignOptions) {
  const db = options.db ?? getPrismaClient()
  const tracks = await db.track.findMany({ orderBy: { sortOrder: 'asc' } })

  const campaign = await db.campaign.create({
    data: {
      name: options.name ?? '测试活动',
      description: '测试用活动',
      startDate: options.startDate,
      endDate: options.endDate,
      dailyOpenTime: options.dailyOpenTime ?? '00:00',
      dailyDeadline: options.dailyDeadline ?? '23:59',
      status: options.status ?? 'active',
      leaderboardVisible: options.leaderboardVisible ?? true,
      leaderboardTime: options.leaderboardTime ?? '06:00',
      nameDisplayMode: options.nameDisplayMode ?? 'real',
      minImages: options.minImages ?? 1,
      maxImages: options.maxImages ?? 3,
      maxImageBytes: options.maxImageBytes ?? 10 * 1024 * 1024,
      campaignTracks: {
        create: tracks.map((track) => {
          const override = options.trackConfig?.[track.slug]
          return {
            trackId: track.id,
            enabled: override?.enabled ?? true,
            dailyPoints: override?.dailyPoints ?? 1000,
            dailyCap: override?.dailyCap ?? null,
            campaignCap: override?.campaignCap ?? null,
            overallWeight: override?.overallWeight ?? 1000,
          }
        }),
      },
    },
  })

  return campaign
}

export async function createParticipant(params: {
  campaignId: string
  userId: string
  className?: string
  status?: string
  db?: Db
}) {
  const db = params.db ?? getPrismaClient()
  return db.campaignParticipant.create({
    data: {
      campaignId: params.campaignId,
      userId: params.userId,
      className: params.className ?? '测试班',
      status: params.status ?? 'active',
    },
  })
}

/** 一步到位：建赛道 + 活动 + 参赛者，返回全部上下文 */
export async function bootstrapCampaign(options: CreateCampaignOptions & { withTracks?: boolean } = {
  startDate: '2026-10-01',
  endDate: '2026-10-07',
}) {
  const db = getPrismaClient()
  const tracks = await createDefaultTracks(db)
  const campaign = await createCampaign({ ...options, db })
  return { db, tracks, campaign }
}

export async function createActivationToken(params: {
  userId: string
  code: string
  expiresAt?: Date
  usedAt?: Date | null
  db?: Db
}) {
  const db = params.db ?? getPrismaClient()
  return db.activationToken.create({
    data: {
      userId: params.userId,
      tokenHash: sha256Hex(params.code),
      expiresAt: params.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usedAt: params.usedAt ?? null,
    },
  })
}

export interface CreateEntryOptions {
  campaignId: string
  participantId: string
  trackId: string
  activityDate: string
  status?: string
  note?: string
  reviewedAt?: Date | null
  reviewedBy?: string | null
  /** 建一条带素材的 revision，用于图片相关测试 */
  withAsset?: boolean
  db?: Db
}

/** 直接构造一条打卡记录（含当前版本），用于摆放审核/计分测试的前置状态 */
export async function createEntry(options: CreateEntryOptions) {
  const db = options.db ?? getPrismaClient()

  const entry = await db.checkinEntry.create({
    data: {
      campaignId: options.campaignId,
      participantId: options.participantId,
      trackId: options.trackId,
      activityDate: options.activityDate,
      status: options.status ?? 'pending',
      reviewedAt: options.reviewedAt ?? null,
      reviewedBy: options.reviewedBy ?? null,
    },
  })

  const revision = await db.submissionRevision.create({
    data: {
      entryId: entry.id,
      revisionNumber: 1,
      note: options.note ?? null,
      assets: options.withAsset
        ? {
            create: {
              // 必须用生产同款的键格式：LocalStorage 只接受 <2 位十六进制分片>/<十六进制串>，
              // 用它自己的 randomObjectKey 生成，夹具素材才能真的通过字节端点读出来
              objectKey: randomObjectKey(),
              mimeType: 'image/jpeg',
              size: 1024,
              width: 100,
              height: 100,
              sha256: 'a'.repeat(64),
            },
          }
        : undefined,
    },
    include: { assets: true },
  })

  const updated = await db.checkinEntry.update({
    where: { id: entry.id },
    data: { currentRevisionId: revision.id },
  })

  return { entry: updated, revision, asset: revision.assets[0] ?? null }
}

/**
 * 生成真实可解码的图片，用于走通上传流水线。
 * 手写 base64 常量容易因为编码细节被 sharp 拒绝，用 sharp 现生成最可靠。
 */
export async function makeImage(
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
  options: { width?: number; height?: number; exif?: boolean } = {},
): Promise<Buffer> {
  const width = options.width ?? 64
  const height = options.height ?? 64

  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })

  if (options.exif) {
    pipeline = pipeline.withExif({
      IFD0: { Make: 'TestCamera', Model: 'ModelX', Software: 'ccme-test' },
      // GPS 信息是 design.md §13 明确要求默认删除的内容
      GPS: { GPSLatitudeRef: 'N', GPSLatitude: '39/1 54/1 0/1' },
    } as never)
  }

  switch (format) {
    case 'png':
      return pipeline.png().toBuffer()
    case 'webp':
      return pipeline.webp().toBuffer()
    default:
      return pipeline.jpeg().toBuffer()
  }
}

/** 一个伪装成 JPEG 的文本文件，用于验证「不按扩展名判断格式」 */
export function fakeJpeg(): Buffer {
  return Buffer.from('这不是图片，只是把扩展名改成了 .jpg 的一段文本。', 'utf8')
}
