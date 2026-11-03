import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { ensureAdmin, verifyPassword, createSession, setSessionCookie, audit } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'
import { db, ensureDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Admin login — bootstrap creates the admin account from env on first use. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  // Brute-force protection.
  if (!rateLimit(`login:ip:${ip}`, env.loginPerIp)) {
    return jsonError('RATE_LIMITED', 429)
  }

  const body = (await readJson(req)) as { username?: unknown; password?: unknown } | null
  const username = typeof body?.username === 'string' ? body.username.trim().slice(0, 100) : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || !password) return jsonError('INVALID_INPUT', 400)

  await ensureAdmin()
  if (!env.adminPassword) return jsonError('SERVER_NOT_CONFIGURED', 500)

  await ensureDb()
  const admin = await db.admin.findUnique({ where: { username } })

  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    await audit('LOGIN_FAILURE', username || null, null, ip)
    // Uniform response — do not reveal whether the account exists.
    return jsonError('INVALID_CREDENTIALS', 401)
  }

  const { token, expiresAt } = await createSession(admin.id, ip, req.headers.get('user-agent'))
  await audit('LOGIN_SUCCESS', admin.username, null, ip)

  const res = jsonOk({ ok: true, username: admin.username })
  setSessionCookie(res, token, expiresAt, req)
  return res
}
