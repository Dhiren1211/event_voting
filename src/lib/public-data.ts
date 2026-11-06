import { db, ensureDb } from '@/lib/db'
import { cacheGet, cacheSet } from '@/lib/cache'
import type { ParticipantPublic } from '@/lib/types'

/**
 * Active participants for the public ballot (no vote counts, ever).
 * Cached in memory for 5 s and shared by the page render and the JSON API,
 * so a crowd of simultaneous visitors costs one DB query per 5 s.
 */
export async function getPublicParticipants(): Promise<ParticipantPublic[]> {
  const cached = cacheGet<{ participants: ParticipantPublic[] }>('public:participants')
  if (cached) return cached.participants
  await ensureDb()
  const participants = (await db.participant.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      performance: true,
      category: true,
      classification: true,
      members: true,
      affiliation: true,
      photoUrl: true,
    },
  })) as ParticipantPublic[]
  cacheSet('public:participants', { participants }, 5_000)
  return participants
}
