import { env } from '../../config/env.js'
import type { UserRole } from '../../config/constants.js'
import { randomToken, sha256Hex } from '../../core/crypto.js'
import { AppError } from '../../core/errors.js'
import { getDummyPasswordHash, hashPassword, verifyPassword } from '../../core/password.js'
import { truncateToSecond } from '../../core/time.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { signAccessToken } from '../../services/tokens.service.js'
import { toPublicUser, type PublicUser } from '../users/serializer.js'

const REFRESH_TTL_MS = env.refreshTokenTtlDays * 24 * 60 * 60 * 1000
const DEVICE_INFO_MAX_LENGTH = 255

export interface TokenBundle {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresAt: Date
}

export interface AuthResult {
  user: PublicUser
  tokens: TokenBundle
}

function normalizeDeviceInfo(deviceInfo: string | undefined): string | null {
  if (!deviceInfo) return null
  return deviceInfo.slice(0, DEVICE_INFO_MAX_LENGTH)
}

async function createRefreshSession(
  prisma: Db,
  userId: string,
  deviceInfo: string | undefined,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)

  const session = await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      deviceInfo: normalizeDeviceInfo(deviceInfo),
    },
    select: { id: true },
  })

  return { id: session.id, token, expiresAt }
}

/** 新建一个刷新会话，并签发配套的访问令牌 */
async function issueTokenBundle(
  prisma: Db,
  user: { id: string; role: string },
  deviceInfo: string | undefined,
): Promise<TokenBundle> {
  const session = await createRefreshSession(prisma, user.id, deviceInfo)

  const accessToken = await signAccessToken({
    subject: user.id,
    sessionId: session.id,
    role: user.role as UserRole,
  })

  return {
    accessToken,
    accessTokenExpiresIn: env.accessTokenTtlSeconds,
    refreshToken: session.token,
    refreshTokenExpiresAt: session.expiresAt,
  }
}

// ---------------------------------------------------------------------------
// 激活
// ---------------------------------------------------------------------------

export async function activateAccount(params: {
  studentId: string
  activationCode: string
  password: string
  deviceInfo?: string
}): Promise<AuthResult> {
  const prisma = getPrismaClient()

  const user = await prisma.user.findUnique({ where: { studentId: params.studentId } })

  // 四种失败共用一个错误码与文案：名单外（design.md §16.1）、已禁用、已激活、激活码无效。
  // 各自给各自的提示等于提供了一个免认证的名单探针 —— 学号是可枚举的低熵值，
  // 「该账号已激活」这句提示就能确认某个学号是否在参赛名单里。
  // 代价是已激活的人重试激活时会看到一句泛泛的提示，激活页本身有更明确的说明兜底。
  const invalidActivation = (): AppError => new AppError('ACTIVATION_INVALID', '学号或激活码不正确')

  if (!user || user.status === 'disabled' || user.passwordHash) {
    throw invalidActivation()
  }

  const tokenHash = sha256Hex(params.activationCode)
  const activation = await prisma.activationToken.findUnique({ where: { tokenHash } })

  if (!activation || activation.userId !== user.id || activation.usedAt || activation.expiresAt.getTime() < Date.now()) {
    throw new AppError('ACTIVATION_INVALID', '学号或激活码不正确，或激活码已失效')
  }

  const passwordHash = await hashPassword(params.password)
  const passwordChangedAt = truncateToSecond(new Date())

  await runInTransaction(prisma, async (tx) => {
    // 激活码一次性：成功使用后立即失效（design.md §7.1）
    await tx.activationToken.update({
      where: { id: activation.id },
      data: { usedAt: new Date() },
    })
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt, status: 'active' },
    })
  })

  const tokens = await issueTokenBundle(prisma, user, params.deviceInfo)

  return {
    user: toPublicUser({ ...user, status: 'active', capabilities: user.capabilities }),
    tokens,
  }
}

// ---------------------------------------------------------------------------
// 登录
// ---------------------------------------------------------------------------

export async function login(params: {
  studentId: string
  password: string
  deviceInfo?: string
}): Promise<AuthResult> {
  const prisma = getPrismaClient()
  const user = await prisma.user.findUnique({ where: { studentId: params.studentId } })

  // 「账号不存在」与「账号尚未激活」对外必须完全一致（design.md §7.1）。
  // 未激活的账号还没有密码，单独回一句「尚未激活」等于告诉任何人这个学号在名单里；
  // 两条路径都做一次哈希校验，连响应时间也不留差异（恒定时间）。
  // 未激活的人该走的是激活流程，登录页常驻着「尚未激活？去激活」的入口。
  if (!user || !user.passwordHash) {
    await verifyPassword(getDummyPasswordHash(), params.password)
    throw new AppError('INVALID_CREDENTIALS', '学号或密码不正确')
  }

  const passwordOk = await verifyPassword(user.passwordHash, params.password)
  if (!passwordOk) {
    throw new AppError('INVALID_CREDENTIALS', '学号或密码不正确')
  }

  if (user.status === 'disabled') {
    throw new AppError('ACCOUNT_DISABLED', '账号已被禁用，请联系管理员')
  }

  const tokens = await issueTokenBundle(prisma, user, params.deviceInfo)

  return { user: toPublicUser(user), tokens }
}

// ---------------------------------------------------------------------------
// 刷新（轮换）
// ---------------------------------------------------------------------------

export async function rotateRefreshToken(params: {
  refreshToken: string
  deviceInfo?: string
}): Promise<AuthResult> {
  const prisma = getPrismaClient()
  const tokenHash = sha256Hex(params.refreshToken)

  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  if (!session) throw new AppError('TOKEN_INVALID', '会话不存在，请重新登录')
  if (session.revokedAt) throw new AppError('TOKEN_INVALID', '会话已失效，请重新登录')
  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError('TOKEN_EXPIRED', '登录已过期，请重新登录')
  }
  if (session.user.status === 'disabled') {
    throw new AppError('ACCOUNT_DISABLED', '账号已被禁用，请联系管理员')
  }
  // 改密后签发时间早于 password_changed_at 的会话一律作废（design.md §7.2）
  if (
    session.user.passwordChangedAt &&
    session.createdAt.getTime() < session.user.passwordChangedAt.getTime()
  ) {
    throw new AppError('TOKEN_INVALID', '密码已变更，请重新登录')
  }

  // 轮换：旧的立即撤销，签新的
  const rotated = await runInTransaction(prisma, async (tx) => {
    await tx.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })
    return createRefreshSession(tx, session.userId, params.deviceInfo ?? session.deviceInfo ?? undefined)
  })

  const accessToken = await signAccessToken({
    subject: session.userId,
    sessionId: rotated.id,
    role: session.user.role as UserRole,
  })

  return {
    user: toPublicUser(session.user),
    tokens: {
      accessToken,
      accessTokenExpiresIn: env.accessTokenTtlSeconds,
      refreshToken: rotated.token,
      refreshTokenExpiresAt: rotated.expiresAt,
    },
  }
}

// ---------------------------------------------------------------------------
// 退出
// ---------------------------------------------------------------------------

export async function logout(refreshToken: string | null): Promise<void> {
  if (!refreshToken) return
  const prisma = getPrismaClient()
  await prisma.refreshSession.updateMany({
    where: { tokenHash: sha256Hex(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// ---------------------------------------------------------------------------
// 修改密码
// ---------------------------------------------------------------------------

export async function changePassword(params: {
  userId: string
  currentPassword: string
  newPassword: string
  deviceInfo?: string
}): Promise<AuthResult> {
  const prisma = getPrismaClient()
  const user = await prisma.user.findUnique({ where: { id: params.userId } })
  if (!user) throw new AppError('NOT_FOUND', '账号不存在')

  if (!user.passwordHash) {
    throw new AppError('ACCOUNT_NOT_ACTIVATED', '账号尚未激活')
  }

  const currentOk = await verifyPassword(user.passwordHash, params.currentPassword)
  if (!currentOk) throw new AppError('INVALID_CREDENTIALS', '当前密码不正确')

  if (await verifyPassword(user.passwordHash, params.newPassword)) {
    throw new AppError('VALIDATION_FAILED', '新密码不能与当前密码相同')
  }

  const passwordHash = await hashPassword(params.newPassword)
  const passwordChangedAt = truncateToSecond(new Date())

  await runInTransaction(prisma, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt },
    })
    // 改密后所有长期会话立即失效（design.md §7.2、§16.13）
    await tx.refreshSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })

  // 给当前设备补发一套新凭证，避免用户改完密码立刻被踢下线
  const tokens = await issueTokenBundle(prisma, user, params.deviceInfo)

  return { user: toPublicUser(user), tokens }
}
