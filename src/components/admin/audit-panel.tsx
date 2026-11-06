'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { adminFetch, type AuditEntry } from './admin-api'

const ACTION_STYLES: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-surface text-ink',
  LOGIN_FAILURE: 'bg-red-50 text-red-600',
  VOTING_OPEN: 'bg-brand-soft text-brand-deep',
  VOTING_RESUME: 'bg-brand-soft text-brand-deep',
  VOTING_PAUSE: 'bg-amber-50 text-amber-700',
  VOTING_CLOSE: 'bg-red-50 text-red-600',
  PARTICIPANT_CREATE: 'bg-brand-soft text-brand-deep',
  PARTICIPANT_UPDATE: 'bg-surface text-ink',
  PARTICIPANT_DELETE: 'bg-red-50 text-red-600',
  PARTICIPANT_REORDER: 'bg-surface text-ink',
  PHOTO_UPLOAD: 'bg-surface text-ink',
  PHOTO_DELETE: 'bg-amber-50 text-amber-700',
  EXPORT_CSV: 'bg-surface text-ink',
  DEV_RESET_VOTES: 'bg-red-50 text-red-600',
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

export function AuditPanel() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ logs: AuditEntry[] }>('/api/admin/audit?limit=300')
      setLogs(data.logs)
    } catch {
      toast.error('Could not load audit log.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription className="text-xs">
            Every administrative action — logins, voting control, participant edits, exports — is recorded here.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <div className="max-h-[62vh] overflow-y-auto rounded-lg border border-line">
          {loading ? (
            <p className="p-8 text-center text-sm text-ink-soft">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-soft">No activity recorded yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 font-semibold">Time</th>
                  <th className="px-3 py-2.5 font-semibold">Action</th>
                  <th className="px-3 py-2.5 font-semibold">Actor</th>
                  <th className="px-3 py-2.5 font-semibold">Details</th>
                  <th className="px-3 py-2.5 font-semibold">IP (hashed)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-ink-soft">{fmt(l.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${ACTION_STYLES[l.action] ?? 'bg-surface text-ink'}`}>
                        {l.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-medium text-ink">{l.actor ?? '—'}</td>
                    <td className="max-w-72 truncate px-3 py-2.5 text-xs text-ink-soft" title={l.details ?? ''}>
                      {l.details ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-ink-soft/60">{l.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
