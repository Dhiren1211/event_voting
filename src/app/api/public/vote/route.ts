import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp, hashIp, shortUa, readJson } from '@/lib/api'
import { isValidDeviceToken, sha256 } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'
import { getVotingState } from '@/lib/voting'
import { env } from '@/lib/env'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Vote submission — the single most important endpoint of the system.
 *
 * Correctness rules:
 * 1. Voting must be OPEN (fast cache check, then a fresh authoritative
 *    re-check after the insert closes the close/pause race window).
 * 2. The participant must exist and be active.
 * 3. Exactly ONE vote per device token — enforced by a UNIQUE index on
 *    votes.deviceTokenHash at the database level, so simultaneous duplicate
 *    submissions are impossible regardless of request timing or order.
 * 4. Success is returned only after the row is durably committed (the
 *    INSERT has returned).
 *
 * Why a plain INSERT instead of an interactive transaction:
 * SQLite writes are serialized at the file level (WAL, single-writer).
 * A single auto-commit INSERT is atomic and avoids interactive-transaction
 * pool starvation under bursts (Prisma P2028/P1008 under 100 concurrent
 * submissions). The UNIQUE index provides the once-per-device guarantee
 * that the transaction would have provided — it is enforced by the
 * database engine itself, not by application code.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const body = await readJson(req)
  const participantId = Number((body as { participantId?: unknown })?.participantId)
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token : ''

  if (!Number.isInteger(participantId) || participantId <= 0 || !isValidDeviceToken(token)) {
    return jsonError('INVALID_INPUT', 400)
  }

  // Rate limits: strict per token (one device), generous per IP (venue NAT).
  if (!rateLimit(`vote:token:${sha256(token)}`, env.votePerToken)) return jsonError('RATE_LIMITED', 429)
  if (!rateLimit(`vote:ip:${ip}`, env.votePerIp)) return jsonError('RATE_LIMITED', 429)

  // Fast fail on closed/paused using the 2s-cached state (avoids DB work).
  const quickState = await getVotingState()
  if (quickState.status === 'CLOSED') return jsonError('VOTING_CLOSED', 403)
  if (quickState.status === 'PAUSED') return jsonError('VOTING_PAUSED', 403)

  await ensureDb()

  // Participant validation (fresh read, indexed PK lookup).
  const participant = await db.participant.findFirst({
    where: { id: participantId, isActive: true },
    select: { id: true, name: true },
  })
  if (!participant) return jsonError('PARTICIPANT_NOT_FOUND', 404)

  // Atomic durable write — UNIQUE(deviceTokenHash) guarantees one vote per
  // device even under simultaneous duplicate submissions.
  let vote
  try {
    vote = await db.vote.create({
      data: {
        participantId: participant.id,
        deviceTokenHash: sha256(token),
        ipHash: hashIp(ip),
        userAgent: shortUa(req.headers.get('user-agent')),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return jsonError('ALREADY_VOTED', 409)
    }
    console.error('vote submission failed:', e)
    return jsonError('VOTE_FAILED', 500)
  }

  // Compensating re-check with fresh state: if the organizer closed/paused
  // voting in the milliseconds between our cached check and the insert,
  // the vote is rolled back and the device is told voting is closed.
  const cfg = await db.votingConfig.findUnique({ where: { id: 1 }, select: { status: true } })
  if (!cfg || cfg.status !== 'OPEN') {
    await db.vote.delete({ where: { id: vote.id } }).catch(() => {})
    return jsonError(cfg?.status === 'PAUSED' ? 'VOTING_PAUSED' : 'VOTING_CLOSED', 403)
  }

  return jsonOk({ ok: true, participantName: participant.name, votedAt: vote.createdAt.toISOString() })
}
