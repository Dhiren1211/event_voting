'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Download, Pause, Play, RefreshCw, Square, Users, Vote, Activity, Clock, ShieldCheck, Timer } from 'lucide-react'
import { adminFetch, type OverviewData } from './admin-api'
import { ParticipantsPanel } from './participants-panel'
import { QrPanel } from './qr-panel'
import { AuditPanel } from './audit-panel'
import { CATEGORY_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatCountdown, useRoundCountdown } from '@/hooks/use-round-countdown'
import { NcbMark } from '@/components/voting/public-shell'

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
  const [savingStrict, setSavingStrict] = useState(false)
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
        action === 'open' ? `Voting is open — ${overviewRef.current?.roundMinutes ?? 5}-minute round started.` :
        action === 'pause' ? 'Voting paused.' :
        action === 'resume' ? `Voting resumed — new ${overviewRef.current?.roundMinutes ?? 5}-minute round started.` :
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

  // Sign out: end the session on the server (deletes it and clears the
  // cookie), then let the page re-check — it will show the login form.
  const [signingOut, setSigningOut] = useState(false)
  async function signOut() {
    setSigningOut(true)
    try {
      await fetch('/api/admin/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      /* even if the request fails, fall through to the session re-check */
    }
    onLogout()
  }

  async function setStrictOneVotePerIp(enabled: boolean) {
    setSavingStrict(true)
    try {
      await adminFetch('/api/admin/voting-settings', {
        method: 'POST',
        body: JSON.stringify({ oneVotePerIp: enabled }),
      })
      toast.success(
        enabled
          ? 'One vote per network is now ON — second votes from the same IP are blocked.'
          : 'One vote per network is now OFF — one vote per device is enforced.'
      )
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the setting.')
    } finally {
      setSavingStrict(false)
    }
  }

  const status = overview?.status
  const remainingMs = useRoundCountdown(status === 'OPEN' ? overview?.autoPauseAt : null, overview?.serverNow)
  const roundMinutes = overview?.roundMinutes ?? 5
  const roundOver = remainingMs === 0
  // When the round runs out, pull the new (auto-paused) state right away.
  useEffect(() => {
    if (!roundOver) return
    const t = setTimeout(() => void refresh(), 800)
    return () => clearTimeout(t)
  }, [roundOver, refresh])
  const statusBadge =
    status === 'OPEN' ? (
      <Badge className="h-7 gap-1.5 rounded-full border-[1.5px] border-brand bg-white px-3 text-brand-deep"><span className="h-1.5 w-1.5 rounded-full bg-brand" />OPEN{remainingMs !== null ? ` · ${formatCountdown(remainingMs)}` : ''}</Badge>
    ) : status === 'PAUSED' ? (
      <Badge className="h-7 gap-1.5 rounded-full border-[1.5px] border-line bg-white px-3 text-heading"><span className="h-1.5 w-1.5 rounded-full bg-subtle" />PAUSED</Badge>
    ) : (
      <Badge variant="outline" className="h-7 gap-1.5 rounded-full border-[1.5px] border-line bg-white px-3 text-subtle"><span className="h-1.5 w-1.5 rounded-full bg-line" />CLOSED</Badge>
    )

  const maxVotes = Math.max(1, ...(overview?.results.map((r) => r.votes) ?? [1]))

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 text-heading backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <NcbMark />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-[14px] leading-tight tracking-[0.18em]"><span className="font-medium">TIHAR</span><span className="font-bold text-brand">VOTE</span></p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-subtle">Admin control room</p>
            </div>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2 text-xs text-subtle">
            <span className={cn('hidden sm:inline', !connected && 'text-alert')}>
              {connected ? `Synced ${fmtTime(lastSync?.toISOString() ?? null)}` : 'Connection lost — retrying…'}
            </span>
            <span className="hidden font-medium text-heading md:inline">{username}</span>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-[1.5px] border-brand bg-white px-5 text-[13px] font-semibold text-brand-deep hover:bg-brand-soft hover:text-brand-deep" onClick={() => void signOut()} disabled={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
              </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-full bg-white p-1 ring-1 ring-line">
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

            <Card className="overflow-hidden rounded-md border-line py-0">
              <div className="grid md:grid-cols-[1fr_auto]">
                <div className="p-5 sm:p-6">
                  <p className="text-[14px] font-medium text-brand">Voting control</p>
                  <h2 className="mt-1 text-[22px] font-bold tracking-tight text-ink">{status === 'OPEN' ? 'Voting is open' : status === 'PAUSED' ? 'Voting is paused' : overview?.closedPermanently ? 'Voting has ended' : 'Ready to open voting?'}</h2>
                  <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-ink-soft">
                    Each <strong>Open</strong> or <strong>Resume</strong> starts a {roundMinutes}-minute round. When the
                    timer runs out, voting pauses by itself — press Resume to start the next {roundMinutes}-minute round.
                    Changes reach every phone within seconds and are audit-logged.
                    {overview?.closedPermanently ? ' Voting has been closed permanently and cannot be reopened.' : ''}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2.5">
                    {status !== 'OPEN' && !overview?.closedPermanently && (
                      <Button
                        onClick={() => void changeStatus(status === 'PAUSED' ? 'resume' : 'open')}
                        disabled={transitioning || !overview}
                        className="shadow-pill h-12 gap-2 rounded-full bg-brand px-7 text-[15px] font-semibold text-white hover:bg-[#00b0d8]"
                      >
                        <Play className="h-4 w-4 fill-white text-white" aria-hidden />
                        {status === 'PAUSED' ? `Resume · ${roundMinutes} min` : `Open voting · ${roundMinutes} min`}
                      </Button>
                    )}
                    {status === 'OPEN' && (
                      <Button
                        onClick={() => void changeStatus('pause')}
                        disabled={transitioning}
                        variant="outline"
                        className="h-12 gap-2 rounded-full border-[1.5px] border-line px-7 text-[15px] font-semibold"
                      >
                        <Pause className="h-4 w-4" aria-hidden />
                        Pause now
                      </Button>
                    )}
                    <Button
                      onClick={() => setConfirmClose(true)}
                      disabled={transitioning || !!overview?.closedPermanently}
                      variant="ghost"
                      className="h-12 gap-2 rounded-full px-5 text-[14px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Square className="h-4 w-4" aria-hidden />
                      Close permanently
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Refresh" className="ml-auto h-12 w-12 rounded-full" onClick={() => void refresh()}>
                      <RefreshCw className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <RoundClock
                  status={status}
                  remainingMs={remainingMs}
                  roundMinutes={roundMinutes}
                  closedPermanently={!!overview?.closedPermanently}
                />
              </div>
            </Card>

            <Card className="rounded-md border-line">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
                    <ShieldCheck className="h-4 w-4 text-brand-deep" aria-hidden />
                    One vote per network (strict)
                  </CardTitle>
                  <CardDescription className="max-w-xl text-xs leading-relaxed">
                    Blocks a second vote from the same IP address — for example a visitor opening another browser or
                    incognito window on the same computer. <strong>Turn OFF on shared venue WiFi:</strong> there, many
                    audience members share one public IP and would be locked out after the first vote. Changes apply
                    immediately and are audit-logged.
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2 pt-1">
                  <span className={cn('text-xs font-semibold', overview?.oneVotePerIp ? 'text-brand-deep' : 'text-ink-soft')}>
                    {overview?.oneVotePerIp ? 'ON' : 'OFF'}
                  </span>
                  <Switch
                    checked={!!overview?.oneVotePerIp}
                    onCheckedChange={(checked) => void setStrictOneVotePerIp(checked)}
                    disabled={savingStrict || !overview}
                    aria-label="Toggle one vote per network"
                  />
                </div>
              </CardHeader>
            </Card>

            <Card className="rounded-md border-line">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="text-[17px] font-bold tracking-tight">Live standing (private)</CardTitle>
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
            <Card className="rounded-md border-line">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="text-[17px] font-bold tracking-tight">Full results — private</CardTitle>
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
    <Card className={cn('rounded-md border-line', accent && 'border-brand bg-brand-soft/60')}>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent ? 'bg-brand text-white' : 'bg-surface text-ink-soft')}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          <p className={cn('font-bold tabular-nums text-ink', small ? 'text-sm' : 'text-2xl')}>{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function TopResults({ results, total, maxVotes }: { results?: OverviewData['results']; total: number; maxVotes: number }) {
  if (!results) return <p className="text-sm text-ink-soft">Loading…</p>
  if (results.every((r) => r.votes === 0)) {
    return <p className="text-sm text-ink-soft">No votes recorded yet.</p>
  }
  return (
    <div className="space-y-3">
      {results.map((r) => (
        <div key={r.participantId} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-ink">{r.name}</span>
            <span className="shrink-0 tabular-nums text-ink-soft">
              {r.votes} {total > 0 && <span className="text-xs">({((r.votes / total) * 100).toFixed(1)}%)</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${(r.votes / maxVotes) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function FullResults({ results, total }: { results?: OverviewData['results']; total: number }) {
  if (!results) return <p className="text-sm text-ink-soft">Loading…</p>
  const max = Math.max(1, ...results.map((r) => r.votes))
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
      {results.map((r, i) => (
        <div key={r.participantId} className="flex items-center gap-3">
          <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-soft">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-ink">
                {r.name}
                {!r.isActive && <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-400">inactive</span>}
                {r.category && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-soft">{CATEGORY_LABELS[r.category] ?? r.category}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink-soft">
                {r.votes} {total > 0 && <span className="text-xs">({((r.votes / total) * 100).toFixed(1)}%)</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className={cn('h-full rounded-full transition-all duration-500', r.votes > 0 ? 'bg-brand' : 'bg-line')} style={{ width: `${(r.votes / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Big round timer on the right of the voting control card. */
function RoundClock({
  status,
  remainingMs,
  roundMinutes,
  closedPermanently,
}: {
  status: OverviewData['status'] | undefined
  remainingMs: number | null
  roundMinutes: number
  closedPermanently: boolean
}) {
  const running = status === 'OPEN' && remainingMs !== null && remainingMs > 0
  const fraction = running ? Math.min(1, remainingMs / (roundMinutes * 60_000)) : 0
  const urgent = running && remainingMs <= 60_000
  const r = 52
  const c = 2 * Math.PI * r

  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface px-5 py-5 text-heading md:w-72 md:flex-col md:justify-center md:border-l md:border-t-0 md:py-6">
      <div className="relative h-28 w-28 shrink-0 md:h-36 md:w-36">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--canvas-line)" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={urgent ? 'var(--alert)' : 'var(--brand)'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-300 ease-linear"
          />
        </svg>
        <div role="timer" aria-live="off" className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              'text-[28px] font-bold tabular-nums leading-none md:text-[34px]',
              urgent && 'text-alert'
            )}
          >
            {running ? formatCountdown(remainingMs) : status === 'OPEN' ? '0:00' : '—'}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">
            {running ? 'left' : status === 'PAUSED' ? 'paused' : closedPermanently ? 'ended' : 'not open'}
          </span>
        </div>
      </div>
      <p className="flex items-start gap-2 text-[13px] leading-snug text-subtle md:text-center">
        <Timer className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep md:hidden" aria-hidden />
        {running
          ? 'Round in progress — voting pauses automatically at 0:00.'
          : status === 'PAUSED'
            ? `Paused. Resume starts a fresh ${roundMinutes}-minute round.`
            : closedPermanently
              ? 'Voting is closed for good.'
              : `Open voting to start the first ${roundMinutes}-minute round.`}
      </p>
    </div>
  )
}
