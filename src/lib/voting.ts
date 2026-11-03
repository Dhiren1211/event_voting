import { db, ensureDb } from '@/lib/db'
import { cacheGet, cacheSet, invalidatePublicCaches } from '@/lib/cache'

export type VotingStatus = 'OPEN' | 'PAUSED' | 'CLOSED'

export type VotingState = {
  status: VotingStatus
  closedPermanently: boolean
  openedAt: string | null
  closedAt: string | null
  updatedAt: string
}

/**
 * Authoritative event-wide voting state. Cached for 2s so that bursts of
 * public reads do not hit the DB, while admin changes take effect almost
 * immediately (cache is invalidated on every admin mutation).
 */
export async function getVotingState(): Promise<VotingState> {
  const cached = cacheGet<VotingState>('voting:status')
  if (cached) return cached
  await ensureDb()
  const cfg = await db.votingConfig.findUnique({ where: { id: 1 } })
  const state: VotingState = {
    status: (cfg?.status as VotingStatus) ?? 'CLOSED',
    closedPermanently: cfg?.closedPermanently ?? false,
    openedAt: cfg?.openedAt?.toISOString() ?? null,
    closedAt: cfg?.closedAt?.toISOString() ?? null,
    updatedAt: (cfg?.updatedAt ?? new Date()).toISOString(),
  }
  cacheSet('voting:status', state, 2_000)
  return state
}

export async function applyVotingAction(
  action: 'open' | 'pause' | 'resume' | 'close'
): Promise<{ ok: true; state: VotingState } | { ok: false; error: string }> {
  await ensureDb()
  const cfg = await db.votingConfig.findUnique({ where: { id: 1 } })
  const current = (cfg?.status as VotingStatus) ?? 'CLOSED'
  const permanentlyClosed = cfg?.closedPermanently ?? false

  if (action === 'open' || action === 'resume') {
    if (permanentlyClosed) {
      return { ok: false, error: 'Voting has been closed permanently and cannot be reopened.' }
    }
    const data = {
      status: 'OPEN' as const,
      openedAt: cfg?.openedAt ?? new Date(),
      closedAt: null,
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
    await db.votingConfig.update({ where: { id: 1 }, data: { status: 'PAUSED' } })
  } else if (action === 'close') {
    await db.votingConfig.upsert({
      where: { id: 1 },
      update: { status: 'CLOSED', closedPermanently: true, closedAt: new Date() },
      create: { id: 1, status: 'CLOSED', closedPermanently: true, closedAt: new Date() },
    })
  }

  invalidatePublicCaches()
  const state = await getVotingState()
  return { ok: true, state }
}
