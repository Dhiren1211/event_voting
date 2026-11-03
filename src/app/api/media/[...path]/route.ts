import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { env } from '@/lib/env'

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

  try {
    const file = await readFile(join(env.uploadDir, 'participants', filename))
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(file.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return jsonError('NOT_FOUND', 404)
  }
}
