import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { invalidatePublicCaches } from '@/lib/cache'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

/** Reorder participants: `ids` is the complete list in the desired display order. */
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const parsed = reorderSchema.safeParse(await readJson(req))
  if (!parsed.success) return jsonError('INVALID_INPUT', 400)

  await ensureDb()
  const updates = parsed.data.ids.map((id, index) =>
    db.participant.update({ where: { id }, data: { sortOrder: index + 1 } })
  )
  await db.$transaction(updates)

  invalidatePublicCaches()
  await audit('PARTICIPANT_REORDER', admin.username, { order: parsed.data.ids }, getClientIp(req))
  return jsonOk({ ok: true })
}
