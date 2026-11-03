import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { invalidatePublicCaches } from '@/lib/cache'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  performance: z.string().trim().max(120).optional().nullable(),
  category: z.enum(['SINGING', 'DANCE', 'RAP', 'BEATBOXING', 'INSTRUMENTAL', 'CULTURAL']).optional().nullable(),
  classification: z.enum(['SOLO', 'GROUP']).optional().nullable(),
  members: z.string().trim().max(500).optional().nullable(),
  affiliation: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  reviewNote: z.string().trim().max(500).optional().nullable(),
})

type Params = { params: Promise<{ id: string }> }

/** Update participant information (fix OCR errors, add missing data, activate/deactivate). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return jsonError('INVALID_INPUT', 400)

  const parsed = updateSchema.safeParse(await readJson(req))
  if (!parsed.success) return jsonError('INVALID_INPUT', 400, { details: parsed.error.issues })
  if (Object.keys(parsed.data).length === 0) return jsonError('EMPTY_UPDATE', 400)

  await ensureDb()
  const existing = await db.participant.findUnique({ where: { id } })
  if (!existing) return jsonError('PARTICIPANT_NOT_FOUND', 404)

  const participant = await db.participant.update({ where: { id }, data: parsed.data })

  invalidatePublicCaches()
  await audit('PARTICIPANT_UPDATE', admin.username, { id, changes: parsed.data }, getClientIp(req))
  return jsonOk({ participant })
}

/**
 * Delete a participant. Participants with recorded votes cannot be deleted
 * (referential integrity + vote history preservation) — deactivate instead.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return jsonError('INVALID_INPUT', 400)

  await ensureDb()
  const existing = await db.participant.findUnique({
    where: { id },
    include: { _count: { select: { votes: true } } },
  })
  if (!existing) return jsonError('PARTICIPANT_NOT_FOUND', 404)
  if (existing._count.votes > 0) {
    return jsonError('HAS_VOTES', 409, {
      message: 'This participant has recorded votes and cannot be deleted. Deactivate it instead to preserve vote integrity.',
    })
  }

  // Clean up local photo file if present.
  if (existing.photoUrl?.startsWith('/api/media/')) {
    const { unlink } = await import('fs/promises')
    const { join } = await import('path')
    const filename = existing.photoUrl.split('/').pop() ?? ''
    if (/^[a-zA-Z0-9._-]+$/.test(filename)) {
      await unlink(join(env_dir(), 'participants', filename)).catch(() => {})
    }
  }

  await db.participant.delete({ where: { id } })
  invalidatePublicCaches()
  await audit('PARTICIPANT_DELETE', admin.username, { id, name: existing.name }, getClientIp(req))
  return jsonOk({ ok: true })
}

function env_dir(): string {
  return process.env.UPLOAD_DIR || '/home/z/my-project/uploads'
}
