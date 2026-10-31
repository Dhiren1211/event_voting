import { NextRequest } from 'next/server'
import { jsonOk, getClientIp } from '@/lib/api'
import { getAdmin, destroySession, clearSessionCookie, audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (admin) {
    await destroySession(req)
    await audit('LOGOUT', admin.username, null, getClientIp(req))
  }
  const res = jsonOk({ ok: true })
  clearSessionCookie(res)
  return res
}
