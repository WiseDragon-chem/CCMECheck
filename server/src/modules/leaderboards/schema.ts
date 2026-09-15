import { z } from 'zod'

export const latestLeaderboardQuerySchema = z.object({
  /** 赛道 slug；省略或传哨兵值表示总榜 */
  track: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
})

export const myRankQuerySchema = z.object({
  track: z.string().trim().min(1).max(64).optional(),
  /** 前后各取多少名（design.md §7.6「当前用户所在行」附近名次） */
  neighbors: z.coerce.number().int().min(0).max(20).default(2),
})

export type LatestLeaderboardQuery = z.infer<typeof latestLeaderboardQuerySchema>
export type MyRankQuery = z.infer<typeof myRankQuerySchema>
