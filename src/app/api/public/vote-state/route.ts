import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, readJson } from '@/lib/api'
import { isValidDeviceToken, sha256 } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Check whether this device has already voted.
 * Returns only the device's own vote (identified by its own token) —
 * never any aggregate results.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req)
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token : ''
  if (!isValidDeviceToken(token)) return jsonError('INVALID_INPUT', 400)

  if (!rateLimit(`vstate:${sha256(token)}`, 30)) return jsonError('RATE_LIMITED', 429)

  await ensureDb()
  const vote = await db.vote.findUnique({
    where: { deviceTokenHash: sha256(token) },
    select: { participant: { select: { name: true } }, createdAt: true },
  })

  return jsonOk({
    voted: !!vote,
    participantName: vote?.participant.name ?? null,
    votedAt: vote?.createdAt.toISOString() ?? null,
  })
}
