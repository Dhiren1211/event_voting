'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Download, Pause, Play, RefreshCw, Square, Users, Vote, Activity, Clock } from 'lucide-react'
import { adminFetch, type OverviewData } from './admin-api'
import { ParticipantsPanel } from './participants-panel'
import { QrPanel } from './qr-panel'
import { AuditPanel } from './audit-panel'
import { CATEGORY_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '—'
  }
}

export function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [connected, setConnected] = useState(true)
  const [confirmClose, setConfirmClose] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const overviewRef = useRef<OverviewData | null>(null)
  overviewRef.current = overview

  const refresh = useCallback(async () => {
    try {
      const data = await adminFetch<OverviewData>('/api/admin/overview')
      setOverview(data)
      setConnected(true)
      setLastSync(new Date())
    } catch (e) {
      const status = e instanceof Error && 'status' in e ? (e as { status: number }).status : 0
      if (status === 401) onLogout()
      else setConnected(false)
    }
  }, [onLogout])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 4000)
    return () => clearInterval(timer)
  }, [refresh])

  async function changeStatus(action: 'open' | 'pause' | 'resume' | 'close') {
    setTransitioning(true)
    try {
      await adminFetch('/api/admin/voting-status', {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      toast.success(
        action === 'open' ? 'Voting is now open.' :
        action === 'pause' ? 'Voting paused.' :
        action === 'resume' ? 'Voting resumed.' :
        'Voting closed permanently.'
      )
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setTransitioning(false)
      setConfirmClose(false)
    }
  }

  const status = overview?.status
  const statusBadge =
    status === 'OPEN' ? (
      <Badge className="gap-1.5 border-transparent bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20"><span className="h-1.5 w-1.5 rounded-full bg-teal-600" />OPEN</Badge>
    ) : status === 'PAUSED' ? (
      <Badge className="gap-1.5 border-transparent bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />PAUSED</Badge>
    ) : (
      <Badge variant="outline" className="gap-1.5 border-zinc-200 text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />CLOSED</Badge>
    )

  const maxVotes = Math.max(1, ...(overview?.results.map((r) => r.votes) ?? [1]))

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tracking-tight text-zinc-900">NCB Voting Admin</span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={cn('hidden sm:inline', !connected && 'text-red-500')}>
              {connected ? `Synced ${fmtTime(lastSync?.toISOString() ?? null)}` : 'Connection lost — retrying…'}
            </span>
            <span className="hidden font-medium text-zinc-700 md:inline">{username}</span>
            <Button variant="outline" size="sm" className="h-8" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg bg-zinc-100 p-1">
            <TabsTrigger value="overview" className="gap-1.5">Overview</TabsTrigger>
            <TabsTrigger value="participants" className="gap-1.5">Participants</TabsTrigger>
            <TabsTrigger value="results" className="gap-1.5">Results</TabsTrigger>
            <TabsTrigger value="qr" className="gap-1.5">QR Code</TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5">Audit Log</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------- overview */}
          <TabsContent value="overview" className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={Vote} label="Total valid votes" value={overview?.totalVotes ?? '…'} accent />
              <StatCard icon={Users} label="Active participants" value={overview ? `${overview.activeParticipantCount}/${overview.participantCount}` : '…'} />
              <StatCard icon={Activity} label="Votes last minute" value={overview?.votesLastMinute ?? '…'} />
              <StatCard icon={Clock} label="Last vote at" value={fmtTime(overview?.lastVoteAt ?? null)} small />
            </div>

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Voting control</CardTitle>
                <CardDescription className="text-xs">
                  Event-wide status. All changes take effect immediately for every visitor and are audit-logged.
                  {overview?.closedPermanently ? ' Voting has been closed permanently and cannot be reopened.' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2.5">
                {status !== 'OPEN' && !overview?.closedPermanently && (
                  <Button onClick={() => void changeStatus('open')} disabled={transitioning} className="gap-2 bg-teal-600 font-semibold hover:bg-teal-700">
                    <Play className="h-4 w-4" aria-hidden />
                    {status === 'PAUSED' ? 'Resume voting' : 'Open voting'}
                  </Button>
                )}
                {status === 'OPEN' && (
                  <Button onClick={() => void changeStatus('pause')} disabled={transitioning} variant="outline" className="gap-2 border-amber-600/30 text-amber-700 hover:bg-amber-50 hover:text-amber-800">
                    <Pause className="h-4 w-4" aria-hidden />
                    Pause
                  </Button>
                )}
                <Button onClick={() => setConfirmClose(true)} disabled={transitioning || !!overview?.closedPermanently} variant="destructive" className="gap-2">
                  <Square className="h-4 w-4" aria-hidden />
                  Close permanently
                </Button>
                <Button variant="outline" size="icon" aria-label="Refresh" className="ml-auto" onClick={() => void refresh()}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">Live standing (private)</CardTitle>
                  <CardDescription className="text-xs">Top 5 — results are visible only to authenticated administrators.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <a href="/api/admin/export?format=results" download>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Results CSV
                    </Button>
                  </a>
                  <a href="/api/admin/export?format=votes" download>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Votes CSV
                    </Button>
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                <TopResults results={overview?.results.slice(0, 5)} total={overview?.totalVotes ?? 0} maxVotes={maxVotes} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------ participants */}
          <TabsContent value="participants">
            <ParticipantsPanel onChanged={refresh} />
          </TabsContent>

          {/* ---------------------------------------------------- results */}
          <TabsContent value="results">
            <Card className="rounded-xl">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">Full results — private</CardTitle>
                  <CardDescription className="text-xs">
                    {overview?.totalVotes ?? 0} valid votes · sorted by vote count. Never exposed publicly.
                  </CardDescription>
                </div>
                <a href="/api/admin/export?format=results" download>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export CSV
                  </Button>
                </a>
              </CardHeader>
              <CardContent>
                <FullResults results={overview?.results} total={overview?.totalVotes ?? 0} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------- qr */}
          <TabsContent value="qr">
            <QrPanel />
          </TabsContent>

          {/* ----------------------------------------------------- audit */}
          <TabsContent value="audit">
            <AuditPanel />
          </TabsContent>
        </Tabs>
      </main>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Close voting permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              Once closed, voting can <strong>never</strong> be reopened. All visitors will immediately see
              &quot;Voting has ended&quot;. This action is final.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitioning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={transitioning}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault()
                void changeStatus('close')
              }}
            >
              {transitioning ? 'Closing…' : 'Close voting permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, accent, small }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; accent?: boolean; small?: boolean }) {
  return (
    <Card className={cn('rounded-xl', accent && 'border-teal-600/20 bg-teal-50/40')}>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent ? 'bg-teal-100 text-teal-700' : 'bg-zinc-100 text-zinc-500')}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
          <p className={cn('font-bold text-zinc-900', small ? 'text-sm' : 'text-xl')}>{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function TopResults({ results, total, maxVotes }: { results?: OverviewData['results']; total: number; maxVotes: number }) {
  if (!results) return <p className="text-sm text-zinc-400">Loading…</p>
  if (results.every((r) => r.votes === 0)) {
    return <p className="text-sm text-zinc-400">No votes recorded yet.</p>
  }
  return (
    <div className="space-y-3">
      {results.map((r) => (
        <div key={r.participantId} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-zinc-800">{r.name}</span>
            <span className="shrink-0 tabular-nums text-zinc-500">
              {r.votes} {total > 0 && <span className="text-xs">({((r.votes / total) * 100).toFixed(1)}%)</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${(r.votes / maxVotes) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function FullResults({ results, total }: { results?: OverviewData['results']; total: number }) {
  if (!results) return <p className="text-sm text-zinc-400">Loading…</p>
  const max = Math.max(1, ...results.map((r) => r.votes))
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
      {results.map((r, i) => (
        <div key={r.participantId} className="flex items-center gap-3">
          <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-400">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-zinc-800">
                {r.name}
                {!r.isActive && <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-400">inactive</span>}
                {r.category && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-zinc-400">{CATEGORY_LABELS[r.category] ?? r.category}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-500">
                {r.votes} {total > 0 && <span className="text-xs">({((r.votes / total) * 100).toFixed(1)}%)</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className={cn('h-full rounded-full transition-all duration-500', r.votes > 0 ? 'bg-teal-600' : 'bg-zinc-200')} style={{ width: `${(r.votes / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
