import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { getVotingState } from '@/lib/voting'
import { cacheGet, cacheSet } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export type Overview = {
  status: string
  closedPermanently: boolean
  openedAt: string | null
  closedAt: string | null
  totalVotes: number
  participantCount: number
  activeParticipantCount: number
  votesLastMinute: number
  votesLast5Minutes: number
  votesLastHour: number
  lastVoteAt: string | null
  results: { participantId: number; name: string; category: string | null; classification: string | null; isActive: boolean; votes: number }[]
}

/** Private admin overview — the ONLY place vote counts are ever exposed. */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const cached = cacheGet<Overview>('admin:overview')
  if (cached) return jsonOk(cached)

  await ensureDb()
  const now = Date.now()
  const state = await getVotingState()

  const [totalVotes, participantCount, activeParticipantCount, votesLastMinute, votesLast5Minutes, votesLastHour, lastVote, grouped] =
    await Promise.all([
      db.vote.count(),
      db.participant.count(),
      db.participant.count({ where: { isActive: true } }),
      db.vote.count({ where: { createdAt: { gte: new Date(now - 60_000) } } }),
      db.vote.count({ where: { createdAt: { gte: new Date(now - 5 * 60_000) } } }),
      db.vote.count({ where: { createdAt: { gte: new Date(now - 60 * 60_000) } } }),
      db.vote.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.participant.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          category: true,
          classification: true,
          isActive: true,
          _count: { select: { votes: true } },
        },
      }),
    ])

  const overview: Overview = {
    status: state.status,
    closedPermanently: state.closedPermanently,
    openedAt: state.openedAt,
    closedAt: state.closedAt,
    totalVotes,
    participantCount,
    activeParticipantCount,
    votesLastMinute,
    votesLast5Minutes,
    votesLastHour,
    lastVoteAt: lastVote?.createdAt.toISOString() ?? null,
    results: grouped
      .map((p) => ({
        participantId: p.id,
        name: p.name,
        category: p.category,
        classification: p.classification,
        isActive: p.isActive,
        votes: p._count.votes,
      }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)),
  }

  cacheSet('admin:overview', overview, 1_000)
  return jsonOk(overview)
}
