import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { getVotingState } from '@/lib/voting'
import { rateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Public voting status — the single source of truth for every client. */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  if (!rateLimit(`read:ip:${ip}`, env.publicReadPerIp)) {
    return jsonError('RATE_LIMITED', 429)
  }
  const state = await getVotingState()
  return jsonOk({
    status: state.status,
    closedPermanently: state.closedPermanently,
    autoPauseAt: state.autoPauseAt,
    serverNow: new Date().toISOString(), // lets phones correct for clock skew in the countdown
  })
}
