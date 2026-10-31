import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, jsonOk } from '@/lib/api'
import { getAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Recent audit log entries (newest first). */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  await ensureDb()
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 200)
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 200, 1), 500)

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return jsonOk({
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor,
      details: l.details,
      ip: l.ip,
      createdAt: l.createdAt.toISOString(),
    })),
  })
}
