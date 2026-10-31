import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { generateDeviceToken } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Issues a cryptographically secure device token (256-bit entropy).
 * The raw token lives only in the visitor's browser storage; the server
 * stores and matches exclusively SHA-256 hashes.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (!rateLimit(`device:ip:${ip}`, env.devicePerIp)) {
    return jsonError('RATE_LIMITED', 429)
  }
  return jsonOk({ token: generateDeviceToken() })
}
