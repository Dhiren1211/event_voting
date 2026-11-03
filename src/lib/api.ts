import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

/** Consistent JSON API envelopes. */
export function jsonOk<T extends object>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init)
}

export function jsonError(error: string, status: number, extra?: object) {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return null
    return await req.json()
  } catch {
    return null
  }
}

/** Client IP — first hop of X-Forwarded-For (we sit behind the Caddy gateway / proxy). */
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** IP is stored hashed only (no raw PII in the database). */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

export function shortUa(ua: string | null): string | null {
  if (!ua) return null
  return ua.slice(0, 200)
}
