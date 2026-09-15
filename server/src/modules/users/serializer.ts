import type { Capability, ParticipantStatus, UserRole, UserStatus } from '../../config/constants.js'

/**
 * API 载荷统一使用 snake_case，与 design.md §12.5 的错误体（request_id 等）保持一致。
 */

export interface PublicUser {
  id: string
  student_id: string
  name: string
  role: UserRole
  status: UserStatus
  capabilities: Capability[]
}

export interface UserLike {
  id: string
  studentId: string
  name: string
  role: string
  status: string
  capabilities?: string | null
}

export function parseCapabilities(raw: string | null | undefined): Capability[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed.filter((item) => typeof item === 'string') as Capability[]) : []
  } catch {
    return []
  }
}

export function toPublicUser(user: UserLike): PublicUser {
  return {
    id: user.id,
    student_id: user.studentId,
    name: user.name,
    role: user.role as UserRole,
    status: user.status as UserStatus,
    capabilities: parseCapabilities(user.capabilities),
  }
}

export interface PublicParticipant {
  id: string
  user_id: string
  student_id: string
  name: string
  class_name: string | null
  status: ParticipantStatus
  account_status: UserStatus
  joined_at: string
}

export interface ParticipantLike {
  id: string
  userId: string
  className: string | null
  status: string
  joinedAt: Date
  user: { studentId: string; name: string; status: string }
}

export function toPublicParticipant(participant: ParticipantLike): PublicParticipant {
  return {
    id: participant.id,
    user_id: participant.userId,
    student_id: participant.user.studentId,
    name: participant.user.name,
    class_name: participant.className,
    status: participant.status as ParticipantStatus,
    account_status: participant.user.status as UserStatus,
    joined_at: participant.joinedAt.toISOString(),
  }
}
