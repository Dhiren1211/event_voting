'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, ShieldCheck, CheckCircle2, AlertCircle, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/voting/status-badge'
import { ParticipantCard, type VoteButtonState } from '@/components/voting/participant-card'
import { CATEGORY_LABELS, type DeviceVoteState, type ParticipantPublic, type VotingStatusInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

const TOKEN_KEY = 'ngtf_device_token'

async function api<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | null
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null }
  }
}

function formatVotedAt(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

export function VotingPage() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<VotingStatusInfo | null>(null)
  const [participants, setParticipants] = useState<ParticipantPublic[]>([])
  const [voteState, setVoteState] = useState<DeviceVoteState | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('ALL')
  const [confirming, setConfirming] = useState<ParticipantPublic | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showVotedScreen, setShowVotedScreen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const tokenRef = useRef<string | null>(null)

  const loadParticipants = useCallback(async () => {
    const { status: code, data } = await api<{ participants: ParticipantPublic[] }>('/api/public/participants')
    if (code === 200 && data?.participants) setParticipants(data.participants)
    return code === 200
  }, [])

  const loadStatus = useCallback(async () => {
    const { status: code, data } = await api<VotingStatusInfo>('/api/public/status')
    if (code === 200 && data) {
      setStatus({ status: data.status, closedPermanently: data.closedPermanently })
      return true
    }
    return false
  }, [])

  const loadVoteState = useCallback(async (t: string) => {
    const { status: code, data } = await api<DeviceVoteState>('/api/public/vote-state', {
      method: 'POST',
      body: JSON.stringify({ token: t }),
    })
    if (code === 200 && data) setVoteState({ voted: data.voted, participantName: data.participantName, votedAt: data.votedAt })
  }, [])

  const initialize = useCallback(async () => {
    setPhase('loading')
    // 1. Device token — generate once, persist in browser storage.
    let t = localStorage.getItem(TOKEN_KEY)
    if (!t) {
      const { data } = await api<{ token: string }>('/api/public/device', { method: 'POST' })
      if (data?.token) {
        t = data.token
        localStorage.setItem(TOKEN_KEY, t)
      }
    }
    tokenRef.current = t
    setToken(t)

    // 2. Status + participants + this device's vote state.
    const [okStatus, okParticipants] = await Promise.all([loadStatus(), loadParticipants()])
    if (t) await loadVoteState(t)
    setPhase(okStatus || okParticipants ? 'ready' : 'error')
  }, [loadParticipants, loadStatus, loadVoteState])

  useEffect(() => {
    void initialize()
    // Poll voting status (keeps open/pause/close in sync without reload).
    const statusTimer = setInterval(() => void loadStatus(), 20_000)
    const participantsTimer = setInterval(() => void loadParticipants(), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadStatus()
        void loadParticipants()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(statusTimer)
      clearInterval(participantsTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [initialize, loadStatus, loadParticipants])

  // Show the dedicated confirmation screen right after this device votes.
  useEffect(() => {
    if (voteState?.voted) setShowVotedScreen(true)
  }, [voteState?.voted])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of participants) if (p.category) set.add(p.category)
    return Array.from(set)
  }, [participants])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return participants.filter((p) => {
      if (category !== 'ALL' && p.category !== category) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.performance ?? '').toLowerCase().includes(q) ||
        (p.affiliation ?? '').toLowerCase().includes(q) ||
        (p.members ?? '').toLowerCase().includes(q)
      )
    })
  }, [participants, query, category])

  const buttonState: VoteButtonState = voteState?.voted
    ? 'voted'
    : status?.status === 'OPEN'
      ? 'open'
      : status?.status === 'PAUSED'
        ? 'paused'
        : 'closed'

  const submitVote = useCallback(
    async (participant: ParticipantPublic) => {
      const t = tokenRef.current
      if (!t) {
        toast.error('Your device is not registered yet. Please reload the page.')
        return
      }
      setSubmitting(true)
      try {
        const { status: code, data } = await api<{ participantName?: string; votedAt?: string; error?: string }>(
          '/api/public/vote',
          { method: 'POST', body: JSON.stringify({ participantId: participant.id, token: t }) }
        )
        if (code === 200 && data?.ok) {
          setVoteState({
            voted: true,
            participantName: data.participantName ?? participant.name,
            votedAt: data.votedAt ?? new Date().toISOString(),
          })
          setShowVotedScreen(true)
          toast.success('Your vote has been recorded. Thank you!')
        } else if (code === 409) {
          await loadVoteState(t)
          setShowVotedScreen(true)
          toast.info('This device has already voted.')
        } else if (code === 403) {
          await loadStatus()
          toast.error(data?.error === 'VOTING_PAUSED' ? 'Voting is currently paused.' : 'Voting is closed.')
        } else if (code === 404) {
          toast.error('This participant is no longer accepting votes.')
          await loadParticipants()
        } else if (code === 429) {
          toast.error('Too many requests. Please wait a moment and try again.')
        } else {
          toast.error('The vote could not be saved. Please try again.')
        }
      } finally {
        setSubmitting(false)
        setConfirming(null)
      }
    },
    [loadParticipants, loadStatus, loadVoteState]
  )

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadStatus(), loadParticipants()])
      if (tokenRef.current) await loadVoteState(tokenRef.current)
      toast.success('Updated.')
    } finally {
      setRefreshing(false)
    }
  }, [loadParticipants, loadStatus, loadVoteState])

  // ------------------------------------------------------------------ render

  const votedScreen = showVotedScreen && voteState?.voted

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
          {/* ------------------------------------------------ header */}
          <header className="mb-6">
            {/* Kept for accessibility — the visual title lives on the landing page. */}
            <h1 className="sr-only">Audience voting — Nepal Grand Tihar Festival 2026</h1>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Official audience voting
              </p>
              <StatusBadge status={status?.status ?? null} />
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-teal-600/15 bg-teal-50/60 px-3.5 py-3 text-xs text-teal-900 sm:text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
              <span>
                Select <strong>one</strong> performance and confirm. Each device can vote <strong>once</strong> — the choice is
                final and cannot be changed.
              </span>
            </div>
          </header>

          {phase === 'loading' && <LoadingSkeleton />}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-10 text-center">
              <AlertCircle className="h-10 w-10 text-zinc-300" aria-hidden />
              <div>
                <p className="font-semibold text-zinc-900">Could not load the voting page</p>
                <p className="mt-1 text-sm text-zinc-500">Check your connection and try again.</p>
              </div>
              <Button onClick={() => void initialize()} variant="outline" className="gap-2">
                <RotateCw className="h-4 w-4" aria-hidden />
                Retry
              </Button>
            </div>
          )}

          {phase === 'ready' && (
            <>
              {/* ------------------------------------- voted confirmation */}
              {votedScreen ? (
                <section
                  aria-label="Vote confirmation"
                  className="mx-auto my-8 flex max-w-md flex-col items-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 ring-1 ring-teal-600/20">
                    <CheckCircle2 className="h-9 w-9 text-teal-600" aria-hidden />
                  </span>
                  <h2 className="mt-5 text-xl font-bold text-zinc-900">Your vote has been recorded</h2>
                  <p className="mt-2 text-sm text-zinc-500">
                    Thank you for participating in the Nepal Grand Tihar Festival 2026.
                  </p>
                  <div className="mt-5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">You voted for</p>
                    <p className="mt-0.5 font-semibold text-zinc-900">{voteState.participantName}</p>
                    {voteState.votedAt ? (
                      <p className="mt-1 text-xs text-zinc-400">Recorded {formatVotedAt(voteState.votedAt)}</p>
                    ) : null}
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-zinc-500">
                    This device has used its single vote. It is no longer possible to vote again or change the choice
                    from this device.
                  </p>
                  <Button variant="ghost" className="mt-5 text-teal-700 hover:text-teal-800" onClick={() => setShowVotedScreen(false)}>
                    Browse participants
                  </Button>
                </section>
              ) : (
                <>
                  {/* ------------------------------------- status banners */}
                  {status?.status === 'PAUSED' && (
                    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                      Voting is temporarily paused. Please check back soon — the organizer will resume it shortly.
                    </div>
                  )}
                  {status?.status === 'CLOSED' && (
                    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
                      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                      {status.closedPermanently
                        ? 'Voting has ended. Thank you to everyone who participated!'
                        : 'Voting is not open yet. It will open when the organizer starts it.'}
                    </div>
                  )}

                  {/* ------------------------------------- search + filters */}
                  <div className="mb-5 space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search participant, group, university…"
                        aria-label="Search participants"
                        className="h-10 rounded-lg border-zinc-200 bg-white pl-9 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <FilterChip active={category === 'ALL'} onClick={() => setCategory('ALL')}>
                        All ({participants.length})
                      </FilterChip>
                      {categories.map((c) => (
                        <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                          {CATEGORY_LABELS[c] ?? c}
                        </FilterChip>
                      ))}
                    </div>
                  </div>

                  {/* ------------------------------------- participant grid */}
                  {filtered.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
                      No participants match your search.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filtered.map((p) => (
                        <ParticipantCard
                          key={p.id}
                          participant={p}
                          buttonState={buttonState}
                          submitting={submitting}
                          onVote={setConfirming}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {!votedScreen && (
                <div className="mt-6 flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => void handleManualRefresh()} disabled={refreshing} className="gap-2 text-xs text-zinc-400 hover:text-zinc-600">
                    <RotateCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
                    Refresh list
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ------------------------------------------------ sticky footer */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-1.5 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center sm:flex-row sm:text-left">
          <Link href="/" className="text-xs font-medium text-teal-700 hover:text-teal-800">
            ← Event home
          </Link>
          <p className="text-[11px] text-zinc-400">Voting is anonymous · One vote per device</p>
        </div>
      </footer>

      {/* ------------------------------------------------ confirm dialog */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Confirm your vote</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>You are about to vote for:</span>
                <span className="mt-2 block rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
                  <span className="block font-semibold text-zinc-900">{confirming?.name}</span>
                  {confirming?.performance ? (
                    <span className="block text-xs text-zinc-500">{confirming.performance}</span>
                  ) : null}
                  {confirming?.affiliation ? (
                    <span className="block text-xs text-zinc-500">{confirming.affiliation}</span>
                  ) : null}
                </span>
                <span className="mt-3 block font-medium text-amber-700">
                  Each device can vote only once. This choice is final and cannot be changed.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              className="bg-teal-600 hover:bg-teal-700"
              onClick={(e) => {
                e.preventDefault()
                if (confirming) void submitVote(confirming)
              }}
            >
              {submitting ? 'Recording vote…' : 'Confirm vote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-teal-600 bg-teal-600 text-white'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'
      )}
    >
      {children}
    </button>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
