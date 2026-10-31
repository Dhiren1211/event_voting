import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { invalidatePublicCaches } from '@/lib/cache'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  performance: z.string().trim().max(120).optional().nullable(),
  category: z.enum(['SINGING', 'DANCE', 'RAP', 'BEATBOXING', 'INSTRUMENTAL', 'CULTURAL']).optional().nullable(),
  classification: z.enum(['SOLO', 'GROUP']).optional().nullable(),
  members: z.string().trim().max(500).optional().nullable(),
  affiliation: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  reviewNote: z.string().trim().max(500).optional().nullable(),
})

/** Full participant list with vote counts (admin-only view). */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  await ensureDb()
  const participants = await db.participant.findMany({
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
      sortOrder: true,
      isActive: true,
      needsReview: true,
      reviewNote: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { votes: true } },
    },
  })

  return jsonOk({
    participants: participants.map(({ _count, ...p }) => ({ ...p, votes: _count.votes })),
  })
}

/** Create a new participant. */
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const parsed = createSchema.safeParse(await readJson(req))
  if (!parsed.success) return jsonError('INVALID_INPUT', 400, { details: parsed.error.issues })

  await ensureDb()
  const max = await db.participant.aggregate({ _max: { sortOrder: true } })
  const participant = await db.participant.create({
    data: { ...parsed.data, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  })

  invalidatePublicCaches()
  await audit('PARTICIPANT_CREATE', admin.username, { id: participant.id, name: participant.name }, getClientIp(req))
  return jsonOk({ participant })
}
