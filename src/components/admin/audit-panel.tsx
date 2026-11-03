'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { adminFetch, type AuditEntry } from './admin-api'

const ACTION_STYLES: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-zinc-100 text-zinc-600',
  LOGIN_FAILURE: 'bg-red-50 text-red-600',
  VOTING_OPEN: 'bg-teal-50 text-teal-700',
  VOTING_RESUME: 'bg-teal-50 text-teal-700',
  VOTING_PAUSE: 'bg-amber-50 text-amber-700',
  VOTING_CLOSE: 'bg-red-50 text-red-600',
  PARTICIPANT_CREATE: 'bg-teal-50 text-teal-700',
  PARTICIPANT_UPDATE: 'bg-zinc-100 text-zinc-600',
  PARTICIPANT_DELETE: 'bg-red-50 text-red-600',
  PARTICIPANT_REORDER: 'bg-zinc-100 text-zinc-600',
  PHOTO_UPLOAD: 'bg-zinc-100 text-zinc-600',
  PHOTO_DELETE: 'bg-amber-50 text-amber-700',
  EXPORT_CSV: 'bg-zinc-100 text-zinc-600',
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
        <div className="max-h-[62vh] overflow-y-auto rounded-lg border border-zinc-200">
          {loading ? (
            <p className="p-8 text-center text-sm text-zinc-400">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-400">No activity recorded yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200">
                  <th className="px-3 py-2.5 font-semibold">Time</th>
                  <th className="px-3 py-2.5 font-semibold">Action</th>
                  <th className="px-3 py-2.5 font-semibold">Actor</th>
                  <th className="px-3 py-2.5 font-semibold">Details</th>
                  <th className="px-3 py-2.5 font-semibold">IP (hashed)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-zinc-500">{fmt(l.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${ACTION_STYLES[l.action] ?? 'bg-zinc-100 text-zinc-600'}`}>
                        {l.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-medium text-zinc-700">{l.actor ?? '—'}</td>
                    <td className="max-w-72 truncate px-3 py-2.5 text-xs text-zinc-400" title={l.details ?? ''}>
                      {l.details ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-300">{l.ip ?? '—'}</td>
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
