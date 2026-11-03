import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { isValidDeviceToken, sha256 } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'
import { joinQueue } from '@/lib/queue'

export const dynamic = 'force-dynamic'

/**
 * Join the voting queue ("Vote now" tap / automatic join when redirected
 * from the voting page). Only possible while voting is OPEN. One queue slot
 * per device token — repeated taps simply return the current position.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const body = await readJson(req)
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token : ''
  if (!isValidDeviceToken(token)) return jsonError('INVALID_INPUT', 400)

  if (!rateLimit(`qjoin:token:${sha256(token)}`, env.queueJoinPerToken)) return jsonError('RATE_LIMITED', 429)
  if (!rateLimit(`q:ip:${ip}`, env.queuePerIp)) return jsonError('RATE_LIMITED', 429)

  const result = await joinQueue(token)
  return jsonOk(result)
}
