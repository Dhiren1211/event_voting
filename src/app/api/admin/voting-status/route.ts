import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { applyVotingAction, getVotingState } from '@/lib/voting'

export const dynamic = 'force-dynamic'

/**
 * Voting control: open | pause | resume | close (permanent).
 * Every transition is validated server-side and audit-logged.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const body = (await readJson(req)) as { action?: unknown } | null
  const action = body?.action
  if (action !== 'open' && action !== 'pause' && action !== 'resume' && action !== 'close') {
    return jsonError('INVALID_INPUT', 400)
  }

  const result = await applyVotingAction(action)
  if (!result.ok) return jsonError('INVALID_TRANSITION', 409, { message: result.error })

  await audit(
    `VOTING_${action.toUpperCase()}`,
    admin.username,
    { status: result.state.status, closedPermanently: result.state.closedPermanently },
    getClientIp(req)
  )

  return jsonOk({ ok: true, status: result.state.status, closedPermanently: result.state.closedPermanently })
}

/** Convenience GET for the dashboard. */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)
  return jsonOk(await getVotingState())
}
