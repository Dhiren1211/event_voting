import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { env } from '@/lib/env'
import { db, ensureDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Only participant photos are served from here, and only whitelisted filenames.
const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

type Params = { params: Promise<{ path: string[] }> }

/** Serves uploaded media with immutable caching. Path traversal is impossible: filenames are strictly whitelisted. */
export async function GET(_req: NextRequest, { params }: Params) {
  const parts = (await params).path
  if (!parts || parts.length !== 2 || parts[0] !== 'participants') return jsonError('NOT_FOUND', 404)

  const filename = parts[1]
  // Strict whitelist: letters, digits, dot, underscore, hyphen only — no slashes, no "..".
  if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..')) return jsonError('NOT_FOUND', 404)

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const contentType = CONTENT_TYPES[ext]
  if (!contentType) return jsonError('NOT_FOUND', 404)

  // Every upload gets a new unique name, so responses can be cached forever —
  // by phones (max-age) and by the CDN in front of the app (s-maxage), so a
  // crowd loading the ballot does not hit the database for each photo.
  const headers = (type: string, length: number) => ({
    'Content-Type': type,
    'Content-Length': String(length),
    'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })

  // 1) Database (works everywhere, including serverless hosts).
  try {
    await ensureDb()
    const media = await db.mediaFile.findUnique({ where: { name: filename } })
    if (media) {
      const bytes = new Uint8Array(media.data)
      return new Response(bytes, { headers: headers(media.contentType, bytes.length) })
    }
  } catch (err) {
    console.error('media lookup failed:', err)
  }

  // 2) Legacy: photos uploaded before database storage, on a host with a disk.
  try {
    const file = await readFile(join(env.uploadDir, 'participants', filename))
    return new Response(new Uint8Array(file), { headers: headers(contentType, file.length) })
  } catch {
    return jsonError('NOT_FOUND', 404)
  }
}
