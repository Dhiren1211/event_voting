import { NextRequest } from 'next/server'
import { db, ensureDb } from '@/lib/db'
import { jsonError, getClientIp } from '@/lib/api'
import { getAdmin, audit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function csvEscape(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * CSV export.
 * ?format=results (default) → ranked results per participant (admin-only).
 * ?format=votes             → full raw vote log (timestamp + participant).
 */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  await ensureDb()
  const format = req.nextUrl.searchParams.get('format') ?? 'results'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  let csv: string
  let filename: string

  if (format === 'votes') {
    const votes = await db.vote.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, participant: { select: { name: true, id: true } } },
    })
    const rows = [
      ['vote_id', 'participant_id', 'participant_name', 'voted_at_utc'],
      ...votes.map((v) => [v.id, v.participant.id, v.participant.name, v.createdAt.toISOString()]),
    ]
    csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    filename = `ngtf-2026-votes-${stamp}.csv`
  } else {
    const participants = await db.participant.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        performance: true,
        category: true,
        classification: true,
        affiliation: true,
        isActive: true,
        _count: { select: { votes: true } },
      },
    })
    const sorted = [...participants].sort((a, b) => b._count.votes - a._count.votes)
    const total = sorted.reduce((sum, p) => sum + p._count.votes, 0)
    const rows = [
      ['rank', 'participant_id', 'name', 'performance', 'category', 'classification', 'affiliation', 'votes', 'percent', 'active'],
      ...sorted.map((p, i) => [
        i + 1,
        p.id,
        p.name,
        p.performance,
        p.category,
        p.classification,
        p.affiliation,
        p._count.votes,
        total > 0 ? ((p._count.votes / total) * 100).toFixed(2) + '%' : '0.00%',
        p.isActive ? 'yes' : 'no',
      ]),
      [],
      ['total_valid_votes', total],
    ]
    csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    filename = `ngtf-2026-results-${stamp}.csv`
  }

  await audit('EXPORT_CSV', admin.username, { format }, getClientIp(req))

  return new Response('\ufeff' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
