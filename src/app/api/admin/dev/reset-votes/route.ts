import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk, getClientIp } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { invalidatePublicCaches } from '@/lib/cache'

export const dynamic = 'force-dynamic'

/**
 * Administrative test/maintenance helper:
 *  - default: deletes ALL votes (use before the real event to clear test data).
 *  - ?full=1: also resets voting status to OPEN (used by load tests to repeat runs).
 * Requires admin authentication and is always audit-logged.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const full = req.nextUrl.searchParams.get('full') === '1'

  await ensureDb()
  const deleted = await db.vote.deleteMany({})
  if (full) {
    await db.votingConfig.upsert({
      where: { id: 1 },
      update: { status: 'OPEN', closedPermanently: false, openedAt: new Date(), closedAt: null },
      create: { id: 1, status: 'OPEN', closedPermanently: false, openedAt: new Date() },
    })
  }

  invalidatePublicCaches()
  await audit(
    'DEV_RESET_VOTES',
    admin.username,
    { deletedVotes: deleted.count, resetStatus: full },
    getClientIp(req)
  )

  return jsonOk({ deletedVotes: deleted.count, statusReset: full })
}
