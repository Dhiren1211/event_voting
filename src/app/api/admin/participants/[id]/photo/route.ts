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
 * - Optimizes with sharp: auto-rotate, max 1080x1080, WebP q86 (~100 KB; sharp on 3x phone screens,
 *   and the CDN serves repeat loads so the crowd does not hit the server).
 * - Stored in the database (MediaFile) so it works on serverless hosts like
 *   Vercel (read-only filesystem); served via /api/media/participants/<name>.
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
  type SharpFn = typeof import('sharp')
  const sharpMod = (await import('sharp')) as unknown
  const sharp: SharpFn =
    typeof sharpMod === 'function' ? (sharpMod as SharpFn) : (sharpMod as { default: SharpFn }).default
  let output: Buffer
  try {
    const input = Buffer.from(await file.arrayBuffer())
    output = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, smartSubsample: true })
      .toBuffer()
  } catch (err) {
    console.error('sharp processing failed:', err)
    return jsonError('IMAGE_PROCESSING_FAILED', 422, { message: 'The file does not look like a valid image.' })
  }

  const filename = `p${id}-${Date.now()}.webp`
  await db.mediaFile.create({ data: { name: filename, contentType: 'image/webp', data: new Uint8Array(output) } })

  // Remove the previous photo (database copy, and a legacy on-disk file if any).
  await removeStoredPhoto(participant.photoUrl)

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

  await removeStoredPhoto(participant.photoUrl)

  const updated = await db.participant.update({ where: { id }, data: { photoUrl: null } })
  invalidatePublicCaches()
  await audit('PHOTO_DELETE', admin.username, { id }, getClientIp(req))
  return jsonOk({ participant: updated })
}

/** Delete a previously uploaded photo: its database copy and any legacy local file. */
async function removeStoredPhoto(photoUrl: string | null): Promise<void> {
  if (!photoUrl?.startsWith('/api/media/participants/')) return
  const name = photoUrl.split('/').pop() ?? ''
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return
  await db.mediaFile.deleteMany({ where: { name } }).catch(() => {})
  try {
    const { unlink } = await import('fs/promises')
    const { join } = await import('path')
    await unlink(join(env.uploadDir, 'participants', name))
  } catch {
    /* no local file (normal on serverless hosts) */
  }
}
