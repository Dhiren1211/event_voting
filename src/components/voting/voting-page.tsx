'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Fingerprint, ListChecks, PartyPopper, Search, Timer, X } from 'lucide-react'
import { toast } from 'sonner'
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
import { PublicShell } from '@/components/voting/public-shell'
import { ParticipantCard, ParticipantPhoto, type VoteButtonState } from '@/components/voting/participant-card'
import { CATEGORY_LABELS, type DeviceVoteState, type ParticipantPublic, type VotingStatusInfo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatCountdown, useRoundCountdown } from '@/hooks/use-round-countdown'

const TOKEN_KEY = 'ngtf_device_token'

async function api<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as T | null
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null }
  }
}

/**
 * Device token (256-bit, base64url), created in the browser with the Web
 * Crypto API — no network round trip before the ballot is usable. The server
 * only ever stores its SHA-256 hash. Falls back to the server endpoint.
 */
async function getDeviceToken(): Promise<string | null> {
  try {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) return saved
  } catch {
    /* storage blocked — still allow voting with an in-memory token */
  }
  let token: string | null = null
  try {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    const { data } = await api<{ token: string }>('/api/public/device', { method: 'POST' })
    token = data?.token ?? null
  }
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* ignore */
    }
  }
  return token
}

export function VotingPage({
  initialParticipants,
  initialStatus,
}: {
  initialParticipants: ParticipantPublic[] | null
  initialStatus: VotingStatusInfo | null
}) {
  const [participants, setParticipants] = useState<ParticipantPublic[]>(initialParticipants ?? [])
  const [loaded, setLoaded] = useState(!!initialParticipants)
  const [status, setStatus] = useState<VotingStatusInfo | null>(initialStatus)
  const [voteState, setVoteState] = useState<DeviceVoteState | null>(null)
  const [myVoteId, setMyVoteId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('ALL')
  const [confirming, setConfirming] = useState<ParticipantPublic | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  const [networkNoticeDismissed, setNetworkNoticeDismissed] = useState(false)
  const tokenRef = useRef<string | null>(null)

  // ---------------------------------------------------------------- data

  const loadParticipants = useCallback(async () => {
    const { status: code, data } = await api<{ participants: ParticipantPublic[] }>('/api/public/participants')
    if (code === 200 && data?.participants) {
      setParticipants(data.participants)
      setLoaded(true)
    }
  }, [])

  const loadStatus = useCallback(async () => {
    const { status: code, data } = await api<VotingStatusInfo>('/api/public/status')
    if (code === 200 && data?.status)
      setStatus({
        status: data.status,
        closedPermanently: data.closedPermanently,
        autoPauseAt: data.autoPauseAt ?? null,
        serverNow: data.serverNow,
      })
  }, [])

  const loadVoteState = useCallback(async (t: string) => {
    const { status: code, data } = await api<DeviceVoteState>('/api/public/vote-state', {
      method: 'POST',
      body: JSON.stringify({ token: t }),
    })
    if (code === 200 && data) {
      setVoteState({ voted: data.voted, participantName: data.participantName, votedAt: data.votedAt, ipVoted: data.ipVoted ?? false })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const t = await getDeviceToken()
      if (cancelled) return
      tokenRef.current = t
      await Promise.all([
        t ? loadVoteState(t) : null,
        initialParticipants ? null : loadParticipants(),
        initialStatus ? null : loadStatus(),
      ])
    })()

    const listTimer = setInterval(() => void loadParticipants(), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadStatus()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(listTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep open / paused / closed in sync without a reload. While paused,
  // check more often so a new round shows up within a few seconds.
  const isPaused = status?.status === 'PAUSED'
  useEffect(() => {
    const timer = setInterval(() => void loadStatus(), isPaused ? 5_000 : 15_000)
    return () => clearInterval(timer)
  }, [isPaused, loadStatus])

  // ---------------------------------------------------------------- round timer

  const remainingMs = useRoundCountdown(status?.status === 'OPEN' ? status.autoPauseAt : null, status?.serverNow)
  const roundOver = remainingMs === 0
  // The moment the round runs out, ask the server (it flips to PAUSED) and
  // keep asking every 2 s until it confirms.
  useEffect(() => {
    if (!roundOver) return
    const first = setTimeout(() => void loadStatus(), 600)
    const again = setInterval(() => void loadStatus(), 2_000)
    return () => {
      clearTimeout(first)
      clearInterval(again)
    }
  }, [roundOver, loadStatus])

  // ---------------------------------------------------------------- vote

  const submitVote = useCallback(
    async (participant: ParticipantPublic) => {
      let t = tokenRef.current
      if (!t) t = tokenRef.current = await getDeviceToken()
      if (!t) {
        toast.error('This browser can’t vote. Try another browser.')
        return
      }
      setSubmitting(true)
      try {
        const { status: code, data } = await api<{ participantName?: string; votedAt?: string; error?: string }>(
          '/api/public/vote',
          { method: 'POST', body: JSON.stringify({ participantId: participant.id, token: t }) }
        )
        if (code === 200) {
          setMyVoteId(participant.id)
          setVoteState({
            voted: true,
            participantName: data?.participantName ?? participant.name,
            votedAt: data?.votedAt ?? new Date().toISOString(),
            ipVoted: false,
          })
          setShowThanks(true)
          window.scrollTo({ top: 0 })
        } else if (code === 409) {
          await loadVoteState(t)
          setShowThanks(true)
          toast('This phone has already voted.')
        } else if (code === 403 && data?.error === 'ALREADY_VOTED_FROM_NETWORK') {
          setVoteState((prev) => (prev ? { ...prev, ipVoted: true } : prev))
          setNetworkNoticeDismissed(false)
        } else if (code === 403) {
          await loadStatus()
          toast(data?.error === 'VOTING_PAUSED' ? 'Voting is paused.' : 'Voting is closed.')
        } else if (code === 404) {
          toast('That performance is no longer available.')
          await loadParticipants()
        } else if (code === 429) {
          toast('Too many attempts. Wait a moment and try again.')
        } else {
          toast('Your vote didn’t go through. Check your connection and try again.')
        }
      } finally {
        setSubmitting(false)
        setConfirming(null)
      }
    },
    [loadParticipants, loadStatus, loadVoteState]
  )

  // ---------------------------------------------------------------- derived

  const categories = useMemo(() => {
    const seen: string[] = []
    for (const p of participants) if (p.category && !seen.includes(p.category)) seen.push(p.category)
    return seen
  }, [participants])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return participants.filter((p) => {
      if (category !== 'ALL' && p.category !== category) return false
      if (!q) return true
      return [p.name, p.performance, p.affiliation, p.members].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [participants, query, category])

  const sections = useMemo(() => {
    if (query.trim() || category !== 'ALL') return [{ key: 'results', title: null as string | null, items: filtered }]
    const order: string[] = []
    const byCat = new Map<string, ParticipantPublic[]>()
    for (const p of filtered) {
      const k = p.category ?? 'OTHER'
      if (!byCat.has(k)) {
        byCat.set(k, [])
        order.push(k)
      }
      byCat.get(k)!.push(p)
    }
    return order.map((k) => ({ key: k, title: CATEGORY_LABELS[k] ?? 'Other', items: byCat.get(k)! }))
  }, [query, category, filtered])

  const effectiveStatus = status?.status === 'OPEN' && roundOver ? 'PAUSED' : status?.status
  const buttonState: VoteButtonState = voteState?.voted
    ? 'voted'
    : effectiveStatus === 'OPEN'
      ? 'open'
      : effectiveStatus === 'PAUSED'
        ? 'paused'
        : 'closed'

  const voted = !!voteState?.voted
  const myParticipant =
    (myVoteId !== null ? participants.find((p) => p.id === myVoteId) : undefined) ??
    participants.find((p) => p.name === voteState?.participantName)
  const networkBlocked = !!voteState && !voted && voteState.ipVoted && !networkNoticeDismissed

  // ---------------------------------------------------------------- render

  // Where this device is in the voting journey (drives the step tracker).
  const step: 1 | 2 | 3 = voted ? 3 : confirming ? 2 : 1
  const steps: StepItem[] = [
    { title: 'Choose', detail: voted ? voteState?.participantName ?? null : confirming?.name ?? 'Pick a performance', icon: ListChecks },
    { title: 'Confirm', detail: voted ? 'Confirmed' : 'Check your choice', icon: Fingerprint },
    { title: 'Done', detail: voted ? 'Vote recorded' : 'One vote per phone', icon: PartyPopper },
  ]

  return (
    <PublicShell status={effectiveStatus ?? null}>
      <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-16 lg:pt-10">
        <aside className="hidden lg:block">
          <div className="sticky top-10">
            <VoteSteps steps={steps} current={step} allDone={voted} />
          </div>
        </aside>

        <div className="min-w-0">
          <MobileSteps steps={steps} current={step} allDone={voted} />

          {showThanks && voted ? (
            /* ------------------------------------- thank-you */
            <section aria-live="polite" className="max-w-md pt-6 lg:pt-0">
              <p className="text-[16px] font-medium text-brand">Step 3</p>
              <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]">
                Thank you for voting!
              </h1>
              <div className="mt-7 flex items-center gap-4 rounded-[4px] border-[1.5px] border-brand bg-white p-3">
                <ParticipantPhoto participant={myParticipant} className="aspect-square w-20 shrink-0 rounded-[2px]" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-deep">Your vote</p>
                  <p className="mt-0.5 truncate text-[17px] font-semibold">{voteState.participantName}</p>
                  {myParticipant?.performance ? (
                    <p className="truncate text-[13px] text-subtle">{myParticipant.performance}</p>
                  ) : null}
                </div>
                <span className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand">
                  <Check className="h-5 w-5 text-white" strokeWidth={3} aria-hidden />
                </span>
              </div>
              <p className="mt-5 text-[15px] text-subtle">Shubha Tihar — enjoy the rest of the show.</p>
              <button
                type="button"
                onClick={() => setShowThanks(false)}
                className="mt-9 h-[52px] w-full rounded-full border-[1.5px] border-brand bg-white px-8 text-[16px] font-semibold text-brand-deep hover:bg-brand-soft sm:w-auto"
              >
                View all performances
              </button>
            </section>
          ) : networkBlocked ? (
            <section className="max-w-md pt-6 lg:pt-0">
              <h1 className="text-[28px] font-bold tracking-tight">This network has already voted</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-subtle">
                Only one vote per network is allowed right now. Switch to mobile data to vote.
              </p>
              <button
                type="button"
                onClick={() => setNetworkNoticeDismissed(true)}
                className="mt-8 h-[52px] w-full rounded-full border-[1.5px] border-brand bg-white px-8 text-[16px] font-semibold text-brand-deep hover:bg-brand-soft sm:w-auto"
              >
                View all performances
              </button>
            </section>
          ) : (
            <>
              <p className="pt-4 text-[16px] font-medium text-brand lg:pt-0">{voted ? 'All done' : 'Step 1'}</p>
              <h1 className="mt-2 max-w-xl text-[28px] font-bold leading-[1.2] tracking-tight sm:text-[34px]">
                {voted ? 'Tonight’s performances' : 'Who gets your vote tonight?'}
              </h1>
              <p className="mt-2 text-[15px] text-subtle">
                {voted ? (
                  <>
                    You voted for <span className="font-semibold text-heading">{voteState.participantName}</span>.
                  </>
                ) : (
                  'Tap a performance to choose it. One vote per phone.'
                )}
              </p>

              <RoundBanner status={status} effectiveStatus={effectiveStatus} remainingMs={remainingMs} voted={voted} />

              {/* ------------------------------------- search + categories (sticky) */}
              <div className="sticky top-0 z-10 -mx-4 mt-6 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:-mx-6 sm:px-6">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search performers"
                    aria-label="Search performers"
                    enterKeyHint="search"
                    className="h-12 w-full rounded-full border-[1.5px] border-canvas-line bg-white pl-11 pr-11 text-[16px] text-heading outline-none placeholder:text-subtle/80 focus-visible:border-brand [&::-webkit-search-cancel-button]:hidden"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-subtle hover:text-heading"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {categories.length > 1 ? (
                  <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
                    {['ALL', ...categories].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(c)}
                        aria-pressed={category === c}
                        className={cn(
                          'h-9 shrink-0 whitespace-nowrap rounded-full border-[1.5px] px-4 text-[13px] font-semibold transition-colors',
                          category === c
                            ? 'border-brand bg-brand-soft text-brand-deep'
                            : 'border-canvas-line bg-white text-subtle hover:border-brand/60 hover:text-heading'
                        )}
                      >
                        {c === 'ALL' ? 'All' : CATEGORY_LABELS[c] ?? c}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* ------------------------------------- grid */}
              {!loaded ? (
                <GridSkeleton />
              ) : filtered.length === 0 ? (
                <p className="py-16 text-center text-[15px] text-subtle">No matches for &ldquo;{query.trim()}&rdquo;</p>
              ) : (
                sections.map((sec) => (
                  <section key={sec.key} aria-label={sec.title ?? 'Search results'} className="mt-6">
                    {sec.title ? (
                      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-subtle">{sec.title}</h2>
                    ) : null}
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
                      {sec.items.map((p) => (
                        <ParticipantCard
                          key={p.id}
                          participant={p}
                          buttonState={buttonState}
                          submitting={submitting}
                          onVote={setConfirming}
                          isMyVote={voted && p.id === myParticipant?.id}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ confirm (step 2) */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && !submitting && setConfirming(null)}>
        <AlertDialogContent className="max-w-[23rem] gap-0 rounded-[6px] border-0 bg-white p-6 text-heading shadow-2xl">
          <AlertDialogHeader className="text-left">
            <p className="text-[15px] font-medium text-brand">Step 2</p>
            <AlertDialogTitle className="mt-1 text-[22px] font-bold leading-snug tracking-tight text-heading">
              Confirm your vote
            </AlertDialogTitle>
          </AlertDialogHeader>
          {confirming ? (
            <div className="mt-4 rounded-[4px] border-[1.5px] border-brand p-2 text-center">
              <ParticipantPhoto participant={confirming} eager className="aspect-[4/3] w-full rounded-[2px]" />
              <p className="mt-3 text-[17px] font-semibold text-brand-deep">{confirming.name}</p>
              {confirming.performance ? <p className="text-[13px] text-subtle">{confirming.performance}</p> : null}
            </div>
          ) : null}
          <AlertDialogDescription className="mt-3 text-[14px] text-subtle">
            You can only vote once — this can’t be changed later.
          </AlertDialogDescription>
          <AlertDialogFooter className="mt-6 flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              disabled={submitting}
              className="shadow-pill h-[52px] w-full rounded-full bg-brand text-[16px] font-semibold text-white hover:bg-[#00b0d8]"
              onClick={(e) => {
                e.preventDefault()
                if (confirming) void submitVote(confirming)
              }}
            >
              {submitting ? 'Sending…' : 'Confirm vote'}
            </AlertDialogAction>
            <AlertDialogCancel
              disabled={submitting}
              className="mt-0 h-12 w-full rounded-full border-0 bg-transparent text-[15px] font-medium text-subtle shadow-none hover:bg-canvas-high hover:text-heading"
            >
              Choose someone else
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PublicShell>
  )
}

// ---------------------------------------------------------------- step tracker

type StepItem = { title: string; detail: string | null; icon: React.ComponentType<{ className?: string }> }

/** Vertical step tracker (desktop): icon + label on the left, progress rail on the right. */
function VoteSteps({ steps, current, allDone }: { steps: StepItem[]; current: number; allDone: boolean }) {
  return (
    <ol aria-label="Voting steps" className="relative">
      {/* rail */}
      <span aria-hidden className="absolute right-[11px] top-2 bottom-2 w-[2px] bg-canvas-line" />
      <span
        aria-hidden
        className="absolute right-[11px] top-2 w-[2px] bg-brand transition-[height] duration-500"
        style={{ height: allDone ? 'calc(100% - 1rem)' : `${((current - 1) / (steps.length - 1)) * 100}%` }}
      />
      {steps.map((s, i) => {
        const n = i + 1
        const done = allDone || n < current
        const active = !allDone && n === current
        const Icon = s.icon
        return (
          <li key={s.title} className="relative flex items-start gap-4 pb-12 last:pb-0" aria-current={active ? 'step' : undefined}>
            <Icon className={cn('mt-0.5 h-7 w-7 shrink-0', done || active ? 'text-brand' : 'text-canvas-line')} />
            <div className="min-w-0 flex-1 pr-10">
              <p className={cn('text-[11px] font-medium', done || active ? 'text-subtle' : 'text-canvas-line')}>Step {n}</p>
              <p className={cn('mt-0.5 text-[15px] font-medium leading-snug', done || active ? 'text-heading' : 'text-subtle/70')}>
                {s.title}
              </p>
              {s.detail ? (
                <p className={cn('mt-0.5 line-clamp-2 text-[12px]', done || active ? 'text-subtle' : 'text-subtle/60')}>{s.detail}</p>
              ) : null}
            </div>
            <StepDot done={done} active={active} className="absolute right-0 top-1" />
          </li>
        )
      })}
    </ol>
  )
}

/** Compact horizontal step tracker for phones / tablets. */
function MobileSteps({ steps, current, allDone }: { steps: StepItem[]; current: number; allDone: boolean }) {
  return (
    <ol aria-label="Voting steps" className="flex items-center pt-2 lg:hidden">
      {steps.map((s, i) => {
        const n = i + 1
        const done = allDone || n < current
        const active = !allDone && n === current
        return (
          <li key={s.title} className="flex flex-1 items-center last:flex-none" aria-current={active ? 'step' : undefined}>
            <span className="flex items-center gap-2">
              <StepDot done={done} active={active} />
              <span className={cn('text-[13px] font-medium', done || active ? 'text-heading' : 'text-subtle/70')}>{s.title}</span>
            </span>
            {n < steps.length ? (
              <span aria-hidden className={cn('mx-3 h-[2px] flex-1 rounded-full', done ? 'bg-brand' : 'bg-canvas-line')} />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function StepDot({ done, active, className }: { done: boolean; active: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
        done && 'bg-brand',
        active && 'border-2 border-brand bg-white',
        !done && !active && 'bg-canvas-line',
        className
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
    </span>
  )
}

/** Round timer while open; a clear notice while paused / closed. */
function RoundBanner({
  status,
  effectiveStatus,
  remainingMs,
  voted,
}: {
  status: VotingStatusInfo | null
  effectiveStatus: VotingStatusInfo['status'] | undefined
  remainingMs: number | null
  voted: boolean
}) {
  if (!status) return null

  if (effectiveStatus === 'OPEN' && remainingMs !== null && remainingMs > 0) {
    const urgent = remainingMs <= 60_000
    return (
      <div
        role="timer"
        aria-live="off"
        className={cn(
          'mt-6 flex items-center gap-3 rounded-[4px] border-[1.5px] px-4 py-3',
          urgent ? 'border-alert/60 bg-alert/5' : 'border-brand/60 bg-brand-soft'
        )}
      >
        <Timer className={cn('h-5 w-5 shrink-0', urgent ? 'text-alert' : 'text-brand-deep')} aria-hidden />
        <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-heading">
          {voted ? 'This voting round ends in' : 'Vote now — this round ends in'}
        </p>
        <span className={cn('text-[24px] font-bold tabular-nums leading-none', urgent ? 'text-alert' : 'text-brand-deep')}>
          {formatCountdown(remainingMs)}
        </span>
      </div>
    )
  }

  if (effectiveStatus === 'OPEN') return null

  return (
    <p role="status" className="mt-6 rounded-[4px] border-[1.5px] border-canvas-line bg-canvas-high px-4 py-3 text-[14px] font-medium text-heading">
      {effectiveStatus === 'PAUSED'
        ? 'Voting is paused. The next round will start shortly — this page updates by itself.'
        : status.closedPermanently
          ? 'Voting has ended. Thank you for taking part!'
          : 'Voting opens soon. This page updates by itself.'}
    </p>
  )
}

function GridSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading performers" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Skeleton className="aspect-square w-full rounded-[4px] bg-canvas-high" />
          <Skeleton className="mt-2.5 h-4 w-3/4 bg-canvas-high" />
          <Skeleton className="mt-1.5 h-3.5 w-1/2 bg-canvas-high" />
        </li>
      ))}
    </ul>
  )
}
