import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { isValidDeviceToken, sha256 } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'
import { queueState } from '@/lib/queue'

export const dynamic = 'force-dynamic'

/**
 * Queue state polling for the lobby page: position in line, or an admission
 * pass when the device's turn arrives. Also validates a pass the voting page
 * presents (`pass` field) so /vote can confirm admission before rendering.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const body = await readJson(req)
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token : ''
  if (!isValidDeviceToken(token)) return jsonError('INVALID_INPUT', 400)

  if (!rateLimit(`qstate:token:${sha256(token)}`, env.queueStatePerToken)) return jsonError('RATE_LIMITED', 429)
  if (!rateLimit(`q:ip:${ip}`, env.queuePerIp)) return jsonError('RATE_LIMITED', 429)

  const result = await queueState(token)
  return jsonOk(result)
}
