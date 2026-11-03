import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { invalidatePublicCaches } from '@/lib/cache'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

type Params = { params: Promise<{ id: string }> }

/**
 * Upload / replace a participant photograph.
 * - Validates MIME type (JPG/JPEG/PNG/WebP) and size (<= MAX_UPLOAD_MB).
 * - Optimizes with sharp: auto-rotate, max 900x900, WebP ~82 quality.
 * - Stored on disk under UPLOAD_DIR/participants, served via /api/media/...
 * - Never AI-generated imagery — actual participant photos uploaded by admins.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return jsonError('INVALID_INPUT', 400)

  await ensureDb()
  const participant = await db.participant.findUnique({ where: { id } })
  if (!participant) return jsonError('PARTICIPANT_NOT_FOUND', 404)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return jsonError('INVALID_FORM', 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) return jsonError('NO_FILE', 400)

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return jsonError('UNSUPPORTED_TYPE', 415, { message: 'Only JPG, JPEG, PNG and WebP images are allowed.' })

  const maxBytes = env.maxUploadMb * 1024 * 1024
  if (file.size <= 0 || file.size > maxBytes) {
    return jsonError('FILE_TOO_LARGE', 413, { message: `Maximum file size is ${env.maxUploadMb} MB.` })
  }

  // Process with sharp — strips metadata, normalizes orientation, compresses.
  // (ESM/CJS interop: bundled import may expose sharp as default or namespace.)
  const sharpMod = (await import('sharp')) as unknown as { default: typeof import('sharp') } & typeof import('sharp')
  const sharp = typeof sharpMod === 'function' ? sharpMod : sharpMod.default ?? (sharpMod.sharp as typeof import('sharp'))
  let output: Buffer
  try {
    const input = Buffer.from(await file.arrayBuffer())
    output = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
  } catch (err) {
    console.error('sharp processing failed:', err)
    return jsonError('IMAGE_PROCESSING_FAILED', 422, { message: 'The file does not look like a valid image.' })
  }

  const { mkdir, writeFile, unlink } = await import('fs/promises')
  const { join } = await import('path')
  const dir = join(env.uploadDir, 'participants')
  await mkdir(dir, { recursive: true })

  const filename = `p${id}-${Date.now()}.webp`
  await writeFile(join(dir, filename), output)

  // Remove the previous photo file, if it was served from local media storage.
  if (participant.photoUrl?.startsWith('/api/media/')) {
    const oldName = participant.photoUrl.split('/').pop() ?? ''
    if (/^[a-zA-Z0-9._-]+$/.test(oldName)) {
      await unlink(join(dir, oldName)).catch(() => {})
    }
  }

  const photoUrl = `/api/media/participants/${filename}`
  const updated = await db.participant.update({ where: { id }, data: { photoUrl } })

  invalidatePublicCaches()
  await audit('PHOTO_UPLOAD', admin.username, { id, photoUrl, bytes: output.length }, getClientIp(req))
  return jsonOk({ photoUrl, participant: updated })
}

/** Remove the participant photograph (public card falls back to a neutral placeholder). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return jsonError('INVALID_INPUT', 400)

  await ensureDb()
  const participant = await db.participant.findUnique({ where: { id } })
  if (!participant) return jsonError('PARTICIPANT_NOT_FOUND', 404)

  if (participant.photoUrl?.startsWith('/api/media/')) {
    const { unlink } = await import('fs/promises')
    const { join } = await import('path')
    const filename = participant.photoUrl.split('/').pop() ?? ''
    if (/^[a-zA-Z0-9._-]+$/.test(filename)) {
      await unlink(join(env.uploadDir, 'participants', filename)).catch(() => {})
    }
  }

  const updated = await db.participant.update({ where: { id }, data: { photoUrl: null } })
  invalidatePublicCaches()
  await audit('PHOTO_DELETE', admin.username, { id }, getClientIp(req))
  return jsonOk({ participant: updated })
}
