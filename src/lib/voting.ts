import { db, ensureDb } from '@/lib/db'
import { cacheGet, cacheSet, invalidatePublicCaches } from '@/lib/cache'
import { env } from '@/lib/env'

export type VotingStatus = 'OPEN' | 'PAUSED' | 'CLOSED'

export type VotingState = {
  status: VotingStatus
  closedPermanently: boolean
  oneVotePerIp: boolean
  openedAt: string | null
  closedAt: string | null
  /** While OPEN: the moment the current round ends and voting auto-pauses. */
  autoPauseAt: string | null
  updatedAt: string
}

/** Length of one voting round (each Open / Resume starts a fresh round). */
export function votingRoundMs(): number {
  return env.votingRoundMinutes * 60_000
}

/** True when an OPEN round's timer has run out (works for Date or ISO string). */
export function roundExpired(status: string, autoPauseAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (status !== 'OPEN' || !autoPauseAt) return false
  const t = typeof autoPauseAt === 'string' ? Date.parse(autoPauseAt) : autoPauseAt.getTime()
  return Number.isFinite(t) && t <= now
}

/**
 * Authoritative event-wide voting state. Cached for up to 2s so that bursts
 * of public reads do not hit the DB, while admin changes take effect almost
 * immediately (cache is invalidated on every admin mutation).
 *
 * Round timer: an OPEN state whose autoPauseAt has passed is flipped to
 * PAUSED here — lazily, on the first read after expiry. Every reader (public
 * status, vote endpoint, admin overview, page render) goes through this
 * function, so the auto-pause holds even if no admin dashboard is open.
 */
export async function getVotingState(): Promise<VotingState> {
  const cached = cacheGet<VotingState>('voting:status')
  if (cached && !roundExpired(cached.status, cached.autoPauseAt)) return cached
  await ensureDb()
  let cfg = await db.votingConfig.findUnique({ where: { id: 1 } })

  if (cfg && roundExpired(cfg.status, cfg.autoPauseAt)) {
    // Conditional update: only the first request after expiry flips it, and an
    // admin action that happened in between (new round / pause) is not undone.
    const flipped = await db.votingConfig.updateMany({
      where: { id: 1, status: 'OPEN', autoPauseAt: cfg.autoPauseAt },
      data: { status: 'PAUSED', autoPauseAt: null },
    })
    if (flipped.count > 0) {
      invalidatePublicCaches()
      await db.auditLog
        .create({
          data: {
            action: 'VOTING_AUTO_PAUSE',
            actor: 'system',
            details: JSON.stringify({ roundEndedAt: cfg.autoPauseAt?.toISOString() }),
          },
        })
        .catch(() => {})
    }
    cfg = await db.votingConfig.findUnique({ where: { id: 1 } })
  }

  const state: VotingState = {
    status: (cfg?.status as VotingStatus) ?? 'CLOSED',
    closedPermanently: cfg?.closedPermanently ?? false,
    oneVotePerIp: cfg?.oneVotePerIp ?? false,
    openedAt: cfg?.openedAt?.toISOString() ?? null,
    closedAt: cfg?.closedAt?.toISOString() ?? null,
    autoPauseAt: cfg?.status === 'OPEN' ? (cfg.autoPauseAt?.toISOString() ?? null) : null,
    updatedAt: (cfg?.updatedAt ?? new Date()).toISOString(),
  }
  cacheSet('voting:status', state, 2_000)
  return state
}

export async function applyVotingAction(
  action: 'open' | 'pause' | 'resume' | 'close'
): Promise<{ ok: true; state: VotingState } | { ok: false; error: string }> {
  await ensureDb()
  // Read through getVotingState first so an expired round is settled to
  // PAUSED before we decide whether this transition is allowed.
  const current = (await getVotingState()).status
  const cfg = await db.votingConfig.findUnique({ where: { id: 1 } })
  const permanentlyClosed = cfg?.closedPermanently ?? false

  if (action === 'open' || action === 'resume') {
    if (permanentlyClosed) {
      return { ok: false, error: 'Voting has been closed permanently and cannot be reopened.' }
    }
    // Every open / resume starts a fresh round timer.
    const data = {
      status: 'OPEN' as const,
      openedAt: cfg?.openedAt ?? new Date(),
      closedAt: null,
      autoPauseAt: new Date(Date.now() + votingRoundMs()),
    }
    await db.votingConfig.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    })
  } else if (action === 'pause') {
    if (current !== 'OPEN') {
      return { ok: false, error: 'Only an open vote can be paused.' }
    }
    await db.votingConfig.update({ where: { id: 1 }, data: { status: 'PAUSED', autoPauseAt: null } })
  } else if (action === 'close') {
    await db.votingConfig.upsert({
      where: { id: 1 },
      update: { status: 'CLOSED', closedPermanently: true, closedAt: new Date(), autoPauseAt: null },
      create: { id: 1, status: 'CLOSED', closedPermanently: true, closedAt: new Date() },
    })
  }

  invalidatePublicCaches()
  const state = await getVotingState()
  return { ok: true, state }
}

/**
 * Anti-fraud toggle: strict "one vote per network (IP)".
 * When enabled, the vote endpoint rejects any SECOND vote coming from the
 * same IP address — closing the "open another browser / incognito window"
 * loophole of the device-token rule. Keep it OFF on shared venue WiFi, where
 * many legitimate voters share one public IP (NAT); there the per-device
 * rule applies instead.
 */
export async function setOneVotePerIp(enabled: boolean): Promise<VotingState> {
  await ensureDb()
  await db.votingConfig.upsert({
    where: { id: 1 },
    update: { oneVotePerIp: enabled },
    create: { id: 1, oneVotePerIp: enabled },
  })
  invalidatePublicCaches()
  return getVotingState()
}
