import { NextRequest } from 'next/server'
import { getPublicParticipants } from '@/lib/public-data'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
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

  const participants = await getPublicParticipants()
  const payload = { participants }
  return jsonOk(payload)
}
