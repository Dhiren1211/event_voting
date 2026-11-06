import { NextRequest } from 'next/server'
import { jsonError, jsonOk, getClientIp, readJson } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'
import { getVotingState, setOneVotePerIp } from '@/lib/voting'

export const dynamic = 'force-dynamic'

/** Admin voting settings — currently the strict "one vote per network" toggle. */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)
  const state = await getVotingState()
  return jsonOk({ oneVotePerIp: state.oneVotePerIp })
}

/**
 * Update voting settings. Body: { oneVotePerIp: boolean }
 * Every change is validated, persisted and audit-logged.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const body = (await readJson(req)) as { oneVotePerIp?: unknown } | null
  if (typeof body?.oneVotePerIp !== 'boolean') return jsonError('INVALID_INPUT', 400)

  const state = await setOneVotePerIp(body.oneVotePerIp)
  await audit('VOTING_SETTINGS', admin.username, { oneVotePerIp: body.oneVotePerIp }, getClientIp(req))

  return jsonOk({ ok: true, oneVotePerIp: state.oneVotePerIp })
}
