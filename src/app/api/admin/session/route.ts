import { NextRequest } from 'next/server'
import { jsonOk } from '@/lib/api'
import { getAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Session check for the admin dashboard (authorization itself is enforced on every admin API). */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonOk({ authenticated: false })
  return jsonOk({ authenticated: true, username: admin.username })
}
