import type { UserStatus } from '../../config/constants.js'
import { generateTemporaryPassword, hashPassword } from '../../core/password.js'
import { truncateToSecond } from '../../core/time.js'
import { AppError, conflict, notFound } from '../../core/errors.js'
import { getPrismaClient, type Db } from '../../db/client.js'
import { runInTransaction } from '../../db/tx.js'
import { recordAudit, type AuditEntry } from '../../services/audit.service.js'
import { revokeAllSessions } from '../../services/sessions.service.js'
import { ACCOUNT_ROLES, type AccountRole } from './schema.js'

/**
 * 后台账号管理（design.md §5「管理管理员账号」）。
 *
 * 管的是 reviewer 与 super_admin 两种后台账号，参赛者在名单页（modules/participants）。
 * 全模块只有超管可用，守卫挂在路由上（见 routes.ts）。
 *
 * 三条规则：
 *   1. 平权 —— 没有「主管理员」，任何超管都能管理其他超管；
 *   2. 不得对自己执行禁用/降级/重置（改名可以）；
 *   3. 系统始终保留至少一个活跃超管。
 *
 * 明文密码只在创建与重置的那一次响应里出现，库里只有哈希（§13）。
 */

/** 审计上下文，由路由层的 auditContextFrom(req) 提供 */
type ActorContext = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>

/**
 * 账号视图需要的列。
 *
 * passwordHash 只用来推导 `activated`，绝不出现在响应里；
 * passwordChangedAt 是「这个人还在用初始密码吗」的唯一线索。
 */
const ACCOUNT_SELECT = {
  id: true,
  studentId: true,
  name: true,
  role: true,
  status: true,
  passwordHash: true,
  passwordChangedAt: true,
  createdAt: true,
} as const

interface AccountRowShape {
  id: string
  studentId: string
  name: string
  role: string
  status: string
  passwordHash: string | null
  passwordChangedAt: Date | null
  createdAt: Date
}

export interface PublicAdminAccount {
  id: string
  student_id: string
  name: string
  role: AccountRole
  status: UserStatus
  /** 是否设置过密码。本模块创建的账号恒为 true，但直接改库等路径可能造出 false，如实反映 */
  activated: boolean
  /** 密码最后变更时间；null 表示从未设置过密码 */
  password_changed_at: string | null
  created_at: string
}

export function toAdminAccount(account: AccountRowShape): PublicAdminAccount {
  return {
    id: account.id,
    student_id: account.studentId,
    name: account.name,
    role: account.role as AccountRole,
    status: account.status as UserStatus,
    activated: account.passwordHash !== null,
    password_changed_at: account.passwordChangedAt?.toISOString() ?? null,
    created_at: account.createdAt.toISOString(),
  }
}

/**
 * 取一个本模块能管理的账号。
 *
 * 参赛者当作不存在 —— 名单页有它自己的入口，这里放行等于开出一条绕过名单流程
 * 改账号的后门（改角色、改密码都会让名单页的展示对不上）。
 */
async function requireAccount(db: Db, accountId: string): Promise<AccountRowShape> {
  const account = await db.user.findUnique({ where: { id: accountId }, select: ACCOUNT_SELECT })
  if (!account || account.role === 'participant') throw notFound('账号不存在或不是后台账号')
  return account
}

// ---------------------------------------------------------------------------
// 不变量：系统始终保留至少一个活跃超管
// ---------------------------------------------------------------------------

function isActiveSuperAdmin(role: string, status: string): boolean {
  return role === 'super_admin' && status === 'active'
}

function countActiveSuperAdmins(db: Db): Promise<number> {
  return db.user.count({ where: { role: 'super_admin', status: 'active' } })
}

/**
 * 写入之前：判断这次变更会不会让活跃超管清零。
 *
 * 可达性：调用者本身必然是活跃超管（requireRole + authenticate 保证），
 * 所以「禁用/降级最后一个超管」在单人场景下其实与「禁止自我操作」重叠 ——
 * 真正常常是它在起作用的是并发场景：A 禁用 B 的同时 B 禁用 A，
 * 先提交的一方让后者的 count 变成 1，这条检查就会拦下第二个写入。
 * 将来若放宽自我操作规则，它也是最后一道防线，别删。
 *
 * 关于「事务内先 count 再写」为什么成立（不要顺手改成 $executeRaw 条件更新）：
 *
 * 两个 runInTransaction 在进程内不会交错 —— @prisma/adapter-better-sqlite3 在 BEGIN
 * 之前要拿一把 per-client 互斥锁，而 getPrismaClient() 是进程级单例、部署形态是单进程
 * （design.md §10.2）。跨进程的场景下，WAL + BEGIN（DEFERRED）会让「先读后写」的过期
 * 快照在升级为写事务时返回 SQLITE_BUSY_SNAPSHOT，这个错误不走 busy handler，
 * 于是输的一方是失败而不是以旧快照静默提交（当前会退化成 500，见 db/tx.ts 的 isBusyError）。
 *
 * 也就是说：判定与写入在同一事务里就足够了。哪怕写成
 * `UPDATE ... WHERE (SELECT COUNT(*) ...) > 1`，子查询用的也是同一个快照，
 * 正确性完全相同，只多出一层阅读成本。
 */
async function assertActiveSuperAdminRemains(
  tx: Db,
  before: { role: string; status: string },
  after: { role: string; status: string },
): Promise<void> {
  // 改的不是活跃超管，或者改完仍是活跃超管 —— 都不可能减少
  if (!isActiveSuperAdmin(before.role, before.status)) return
  if (isActiveSuperAdmin(after.role, after.status)) return

  // 此时还没写库，before 自己仍在计数里：剩 1 个就说明被改的正是最后一个
  if ((await countActiveSuperAdmins(tx)) <= 1) {
    throw conflict(
      'STATE_TRANSITION_INVALID',
      '系统必须至少保留一个活跃的超级管理员，请先创建或启用另一个超管账号',
    )
  }
}

/**
 * 写入之后再数一次。
 *
 * 看着冗余，但它防的是上面那段投影逻辑自己写错（例如将来新增了某个让超管
 * 变成非活跃的分支却忘了同步投影）—— 那种错误只会表现为「超管全没了」，
 * 事后无法补救。代价是一次 COUNT，而账号管理是低频操作。
 */
async function assertActiveSuperAdminExists(tx: Db): Promise<void> {
  if ((await countActiveSuperAdmins(tx)) < 1) {
    throw conflict('STATE_TRANSITION_INVALID', '系统必须至少保留一个活跃的超级管理员')
  }
}

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

export async function listAccounts(params: {
  role?: AccountRole
  keyword?: string
  skip: number
  take: number
}): Promise<{ items: PublicAdminAccount[]; total: number; activeSuperAdminCount: number }> {
  const prisma = getPrismaClient()

  const roleFilter = params.role ?? { in: [...ACCOUNT_ROLES] }

  const where = {
    role: roleFilter,
    // 关键字同时匹配学号与姓名；SQLite 的 LIKE 对 ASCII 天然不区分大小写
    ...(params.keyword
      ? { OR: [{ studentId: { contains: params.keyword } }, { name: { contains: params.keyword } }] }
      : {}),
  }

  const [items, total, activeSuperAdminCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: ACCOUNT_SELECT,
      // 超管排在前面（role 降序），同角色内按学号 —— 管理员核对「谁还有权限」时顺序稳定
      orderBy: [{ role: 'desc' }, { studentId: 'asc' }],
      skip: params.skip,
      take: params.take,
    }),
    prisma.user.count({ where }),
    // 统计始终是全局的，不受筛选影响：它是这一页的不变量，不是筛选结果的属性
    countActiveSuperAdmins(prisma),
  ])

  return { items: items.map(toAdminAccount), total, activeSuperAdminCount }
}

// ---------------------------------------------------------------------------
// 创建 / 修改 / 重置密码
// ---------------------------------------------------------------------------

export async function createAccount(params: {
  studentId: string
  name: string
  role: AccountRole
  actor: ActorContext
}): Promise<{ account: PublicAdminAccount; password: string }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()

  // 初始密码由系统生成、只展示一次，库里只存哈希（§13）。
  //
  // 哈希刻意放在事务之外：Argon2 要几十到上百毫秒，而 adapter 的互斥锁会让
  // 事务期间的所有写事务排队（同名处理见 participants/service.ts 的 resetParticipantPassword）。
  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)
  const passwordChangedAt = truncateToSecond(new Date())

  const created = await runInTransaction(prisma, async (tx) => {
    const existing = await tx.user.findUnique({
      where: { studentId: params.studentId },
      select: { id: true, role: true },
    })

    if (existing) {
      // 双向都要拦。参赛者改成后台账号会留下一个没有参赛记录的账号；
      // 后台账号被名单页的导入覆盖则会丢掉它自己的角色（名单侧有对称的一条检查）
      throw conflict(
        'DUPLICATE_RECORD',
        existing.role === 'participant' ? '该学号已被参赛者账号占用' : '该学号已被其他后台账号占用',
      )
    }

    const account = await tx.user.create({
      data: {
        studentId: params.studentId,
        name: params.name,
        role: params.role,
        // 初始密码由管理员当面/私下转交，不需要激活流程，建好即可用
        status: 'active',
        passwordHash,
        passwordChangedAt,
      },
      select: ACCOUNT_SELECT,
    })

    await recordAudit(
      {
        ...params.actor,
        action: 'account.create',
        targetType: 'user',
        targetId: account.id,
        // 明文与哈希都不进审计（§13）
        after: { student_id: account.studentId, name: account.name, role: account.role },
      },
      tx,
    )

    return account
  })

  return { account: toAdminAccount(created), password }
}

export async function updateAccount(params: {
  accountId: string
  name?: string
  role?: AccountRole
  status?: 'active' | 'disabled'
  actor: ActorContext
}): Promise<{ account: PublicAdminAccount; revoked_sessions: number }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()

  const outcome = await runInTransaction(prisma, async (tx) => {
    const before = await requireAccount(tx, params.accountId)

    const nextRole = params.role ?? (before.role as AccountRole)
    const nextStatus = params.status ?? before.status
    const changed = {
      name: params.name !== undefined && params.name !== before.name,
      role: nextRole !== before.role,
      status: nextStatus !== before.status,
    }

    // 禁止自我操作：禁用与降级只能由其他管理员发起，避免误点把自己锁在外面。
    // 改名不在此列 —— 它不改变任何人能做什么（系统也没有别的自助改名入口）。
    if (before.id === params.actor.actorId && (changed.role || changed.status)) {
      throw conflict('STATE_TRANSITION_INVALID', '不能禁用或降级自己的账号，请让其他超级管理员操作')
    }

    await assertActiveSuperAdminRemains(tx, before, { role: nextRole, status: nextStatus })

    // 解禁一个从未设置过密码的账号会造出「能登录但进不去」的死状态 ——
    // 后台账号没有激活流程兜底，只能先重置密码
    if (changed.status && nextStatus === 'active' && before.passwordHash === null) {
      throw conflict('STATE_TRANSITION_INVALID', '该账号尚未设置密码，请先重置密码再启用')
    }

    if (changed.name || changed.role || changed.status) {
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...(changed.name ? { name: params.name } : {}),
          ...(changed.role ? { role: nextRole } : {}),
          ...(changed.status
            ? { status: nextStatus, disabledAt: nextStatus === 'disabled' ? new Date() : null }
            : {}),
        },
      })
    }

    // 禁用要立刻生效：撤销全部刷新会话，否则旧令牌还能换到新的访问令牌（§7.2）。
    //
    // 降级**不**撤销会话，这是有意的：authenticate 每次请求都从库里读 role，
    // 降级在下一个请求就生效，留着会话让本人以新角色继续使用即可。
    const revokedSessions =
      changed.status && nextStatus === 'disabled' ? await revokeAllSessions(tx, before.id) : 0

    await assertActiveSuperAdminExists(tx)

    // 什么都没变时不写审计 —— 那会留下一批「改了个寂寞」的记录，
    // 让真正需要追溯的条目淹没在里面。这里也顺带让接口对重复提交是幂等的。
    if (changed.name || changed.role || changed.status) {
      await recordAudit(
        {
          ...params.actor,
          action: changed.status ? 'account.status.update' : 'account.update',
          targetType: 'user',
          targetId: before.id,
          before: { name: before.name, role: before.role, status: before.status },
          after: {
            ...(changed.name ? { name: params.name } : {}),
            ...(changed.role ? { role: nextRole } : {}),
            ...(changed.status ? { status: nextStatus, revoked_sessions: revokedSessions } : {}),
          },
        },
        tx,
      )
    }

    return { id: before.id, revokedSessions }
  })

  const account = await requireAccount(prisma, outcome.id)
  return { account: toAdminAccount(account), revoked_sessions: outcome.revokedSessions }
}

export async function resetAccountPassword(params: {
  accountId: string
  actor: ActorContext
}): Promise<{ account: PublicAdminAccount; password: string }> {
  if (!params.actor.actorId) throw new AppError('UNAUTHENTICATED', '请先登录')

  const prisma = getPrismaClient()
  const target = await requireAccount(prisma, params.accountId)

  // 禁止自我操作：重置自己的密码走「修改密码」入口（/auth/change-password），
  // 那条路要求提供当前密码，是对「是本人」的一次证明；这里放行等于绕开它
  if (target.id === params.actor.actorId) {
    throw conflict('STATE_TRANSITION_INVALID', '不能在账号管理里重置自己的密码，请使用「修改密码」')
  }

  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)
  const passwordChangedAt = truncateToSecond(new Date())

  await runInTransaction(prisma, async (tx) => {
    // 事务内重新取一次：外面那次读只用于自我操作判断，不参与写入
    const account = await requireAccount(tx, params.accountId)

    await tx.user.update({
      where: { id: account.id },
      // 状态不动 —— 已禁用的保持禁用，解禁仍是管理员的显式操作
      data: { passwordHash, passwordChangedAt },
    })

    // 重置密码后旧会话全部失效（§7.2）
    await revokeAllSessions(tx, account.id)

    await recordAudit(
      {
        ...params.actor,
        action: 'account.password.reset',
        targetType: 'user',
        targetId: account.id,
        // 明文与哈希都不进审计（§13）
        after: { student_id: account.studentId, password_changed_at: passwordChangedAt },
      },
      tx,
    )
  })

  const account = await requireAccount(prisma, params.accountId)
  return { account: toAdminAccount(account), password }
}
