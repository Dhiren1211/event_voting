import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp, hashIp, shortUa, readJson } from '@/lib/api'
import { isValidDeviceToken, sha256 } from '@/lib/device'
import { rateLimit } from '@/lib/rate-limit'
import { getVotingState, roundExpired } from '@/lib/voting'
import { releaseQueueSlot } from '@/lib/queue'
import { getPublicParticipants } from '@/lib/public-data'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// In-process lock for the strict per-network check+insert critical section.
// Single-process deployment (same assumption as the admission queue). Without
// it, two simultaneous submissions from the same IP could both pass the
// findFirst check and both insert. The chain never stays rejected.
// ---------------------------------------------------------------------------
const voteLockGlobal = globalThis as unknown as { __ngtfVoteLock?: Promise<void> }

async function withVoteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = voteLockGlobal.__ngtfVoteLock ?? Promise.resolve()
  const run = prev.then(fn, fn) // run whether or not the previous attempt failed
  voteLockGlobal.__ngtfVoteLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

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
 * 5. STRICT MODE (admin toggle oneVotePerIp): at most ONE vote per IP
 *    address — closes the "second browser / incognito" loophole of the
 *    device-token rule. Intended for networks where every device has its
 *    own address; must stay OFF on shared venue WiFi (NAT).
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

  // Participant validation against the shared 5 s active-participant cache
  // (invalidated on every admin participant mutation). Saves a full DB round
  // trip per vote, which matters a lot when the DB is in a distant region.
  const participant = (await getPublicParticipants()).find((p) => p.id === participantId)
  if (!participant) return jsonError('PARTICIPANT_NOT_FOUND', 404)

  // Atomic durable write — UNIQUE(deviceTokenHash) guarantees one vote per
  // device even under simultaneous duplicate submissions. With strict mode
  // enabled, a per-IP duplicate check runs inside the same lock as the
  // insert so the check and the write cannot interleave.
  const ipHashValue = hashIp(ip)

  type VoteAttempt =
    | { ok: true; vote: { id: number; createdAt: Date } }
    | { ok: false; code: 'ALREADY_VOTED' | 'ALREADY_VOTED_FROM_NETWORK' | 'VOTE_FAILED' }

  const insertVote = async (): Promise<VoteAttempt> => {
    try {
      const vote = await db.vote.create({
        data: {
          participantId: participant.id,
          deviceTokenHash: sha256(token),
          ipHash: ipHashValue,
          userAgent: shortUa(req.headers.get('user-agent')),
        },
      })
      return { ok: true, vote }
    } catch (e) {
      // P2002 = unique constraint (this device already voted). Checked by code
      // as well as class so it holds across Prisma engine/adapter variants.
      if ((e as { code?: string } | null)?.code === 'P2002') {
        return { ok: false, code: 'ALREADY_VOTED' }
      }
      console.error('vote submission failed:', e)
      return { ok: false, code: 'VOTE_FAILED' }
    }
  }

  const attempt: VoteAttempt = quickState.oneVotePerIp
    ? await withVoteLock(async () => {
        const dupFromNetwork = await db.vote.findFirst({
          where: { ipHash: ipHashValue },
          select: { id: true },
        })
        if (dupFromNetwork) return { ok: false, code: 'ALREADY_VOTED_FROM_NETWORK' } as VoteAttempt
        return insertVote()
      })
    : await insertVote()

  if (!attempt.ok) {
    if (attempt.code === 'ALREADY_VOTED') return jsonError('ALREADY_VOTED', 409)
    if (attempt.code === 'ALREADY_VOTED_FROM_NETWORK') return jsonError('ALREADY_VOTED_FROM_NETWORK', 403)
    return jsonError('VOTE_FAILED', 500)
  }
  const vote = attempt.vote

  // Compensating re-check with fresh state: if the organizer closed/paused
  // voting in the milliseconds between our cached check and the insert,
  // the vote is rolled back and the device is told voting is closed.
  // A round whose timer has run out counts as PAUSED, even if no request has
  // flipped the stored status yet.
  const cfg = await db.votingConfig.findUnique({ where: { id: 1 }, select: { status: true, autoPauseAt: true } })
  if (cfg && roundExpired(cfg.status, cfg.autoPauseAt)) cfg.status = 'PAUSED'
  if (!cfg || cfg.status !== 'OPEN') {
    await db.vote.delete({ where: { id: vote.id } }).catch(() => {})
    return jsonError(cfg?.status === 'PAUSED' ? 'VOTING_PAUSED' : 'VOTING_CLOSED', 403)
  }

  // The device is done — free its queue slot immediately so the next
  // devices in line are admitted without waiting for the pass TTL.
  // Fire-and-forget: the voter does not need to wait for this (errors are
  // swallowed inside releaseQueueSlot; the pass TTL is the fallback).
  void releaseQueueSlot(token)

  return jsonOk({ ok: true, participantName: participant.name, votedAt: vote.createdAt.toISOString() })
}
