import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { cacheGet, cacheSet } from '@/lib/cache'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Public participant list.
 * Privacy: vote counts are NEVER exposed here. Only active participants,
 * only fields that exist on the official participant record.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  if (!rateLimit(`read:ip:${ip}`, env.publicReadPerIp)) {
    return jsonError('RATE_LIMITED', 429)
  }

  const cached = cacheGet<unknown>('public:participants')
  if (cached) return jsonOk(cached as { participants: unknown[] })

  await ensureDb()
  const participants = await db.participant.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      performance: true,
      category: true,
      classification: true,
      members: true,
      affiliation: true,
      photoUrl: true,
    },
  })

  const payload = { participants }
  cacheSet('public:participants', payload, 5_000)
  return jsonOk(payload)
}
