import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { env, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/env'
import { sha256 } from '@/lib/device'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// ---------------------------------------------------------------------------
// Password hashing (scrypt with per-password salt)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

// ---------------------------------------------------------------------------
// Admin bootstrap — created from env on first login attempt
// ---------------------------------------------------------------------------

export async function ensureAdmin(): Promise<void> {
  await ensureDb()
  if (!env.adminPassword) {
    console.error('ADMIN_PASSWORD is not set — admin login is disabled.')
    return
  }
  const existing = await db.admin.findUnique({ where: { username: env.adminUsername } })
  if (!existing) {
    await db.admin.create({
      data: { username: env.adminUsername, passwordHash: hashPassword(env.adminPassword) },
    })
  }
}

// ---------------------------------------------------------------------------
// Session management — DB-backed, cookie carries only a random opaque token
// ---------------------------------------------------------------------------

export async function createSession(
  adminId: number,
  ip: string | null,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.adminSession.create({
    data: { id: sha256(token), adminId, expiresAt, ip, userAgent: userAgent?.slice(0, 200) ?? null },
  })
  return { token, expiresAt }
}

export type AdminIdentity = { id: number; username: string }

/** Reads the session cookie and validates it against the database. */
export async function getAdmin(req: NextRequest): Promise<AdminIdentity | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token || token.length < 40) return null
  await ensureDb()
  const session = await db.adminSession.findUnique({
    where: { id: sha256(token) },
    include: { admin: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.adminSession.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return { id: session.admin.id, username: session.admin.username }
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date, req: NextRequest) {
  const isHttps = (req.headers.get('x-forwarded-proto') ?? '') === 'https'
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    expires: expiresAt,
    path: '/',
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}

/** Deletes the current session (logout). */
export async function destroySession(req: NextRequest): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    await db.adminSession.delete({ where: { id: sha256(token) } }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export async function audit(
  action: string,
  actor: string | null,
  details: Record<string, unknown> | null,
  ip: string | null
): Promise<void> {
  await db.auditLog
    .create({
      data: {
        action,
        actor,
        details: details ? JSON.stringify(details) : null,
        ip,
      },
    })
    .catch((e) => console.error('audit write failed', e))
}
