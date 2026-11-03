'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  Hourglass,
  ListOrdered,
  PartyPopper,
  RotateCw,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/voting/status-badge'
import type { QueueApiResponse, QueueClientState } from '@/lib/types'
import { cn } from '@/lib/utils'

const TOKEN_KEY = 'ngtf_device_token'
const PASS_KEY = 'ngtf_queue_pass'

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

function formatEta(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds <= 0) return 'Any moment now'
  if (seconds < 60) return 'Less than a minute'
  return `About ${Math.ceil(seconds / 60)} min`
}

export function QueueLobby() {
  const router = useRouter()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [votingStatus, setVotingStatus] = useState<QueueApiResponse['votingStatus'] | null>(null)
  const [closedPermanently, setClosedPermanently] = useState(false)
  const [queue, setQueue] = useState<QueueClientState | null>(null)
  const [joining, setJoining] = useState(false)
  const tokenRef = useRef<string | null>(null)
  const passRef = useRef<string | null>(null)

  /** Store the admission pass and hand the device over to the voting page. */
  const admit = useCallback(
    (pass: string) => {
      try {
        sessionStorage.setItem(PASS_KEY, pass)
      } catch {
        /* private mode — the voting page will re-request admission */
      }
      setQueue({ status: 'ADMITTED', pass, expiresAt: new Date().toISOString() })
      // Give the "You're in" state a beat, then move on.
      setTimeout(() => router.replace('/vote'), 1_200)
    },
    [router]
  )

  const sync = useCallback(
    async (autoJoin: boolean): Promise<boolean> => {
      const t = tokenRef.current
      if (!t) return false

      // 1. Ask the server for the current queue state (and validate any pass).
      let pass: string | null = null
      try {
        pass = sessionStorage.getItem(PASS_KEY)
      } catch {
        pass = null
      }
      passRef.current = pass

      let res = await api<QueueApiResponse>('/api/public/queue/state', {
        method: 'POST',
        body: JSON.stringify({ token: t, ...(pass ? { pass } : {}) }),
      })
      let payload = res.data

      // 2. Auto-join when arriving with the intent to vote (?auto=1) and
      //    this device is not in line yet.
      if (autoJoin && payload && payload.votingStatus === 'OPEN' && !payload.queue) {
        res = await api<QueueApiResponse>('/api/public/queue/join', {
          method: 'POST',
          body: JSON.stringify({ token: t }),
        })
        payload = res.data
      }
      if (!payload) return false

      setVotingStatus(payload.votingStatus)
      setClosedPermanently(payload.closedPermanently)

      if (payload.queue?.status === 'ADMITTED') {
        admit(payload.queue.pass)
        return true
      }
      if (payload.queue?.status === 'WAITING') {
        // Drop any stale pass — this device is (back) in line.
        try {
          sessionStorage.removeItem(PASS_KEY)
        } catch {
          /* ignore */
        }
        setQueue({ status: 'WAITING', position: payload.queue.position, ahead: payload.queue.ahead, etaSeconds: payload.queue.etaSeconds })
        return true
      }
      setQueue(null)
      return true
    },
    [admit]
  )

  const initialize = useCallback(
    async (autoJoin: boolean) => {
      setPhase('loading')
      // Device token — generate once, persist in browser storage.
      let t = localStorage.getItem(TOKEN_KEY)
      if (!t) {
        const { data } = await api<{ token: string }>('/api/public/device', { method: 'POST' })
        if (data?.token) {
          t = data.token
          localStorage.setItem(TOKEN_KEY, t)
        }
      }
      tokenRef.current = t
      if (!t) {
        setPhase('error')
        return
      }
      const ok = await sync(autoJoin)
      setPhase(ok ? 'ready' : 'error')
    },
    [sync]
  )

  // Initial load. `?auto=1` means the visitor just tapped a vote button
  // somewhere (landing page, QR code, voting page redirect) — join instantly.
  const autoJoinRef = useRef(false)
  useEffect(() => {
    const auto = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auto') === '1'
    autoJoinRef.current = auto
    void initialize(auto)
  }, [initialize])

  // Live updates: poll faster when close to the front.
  useEffect(() => {
    if (phase !== 'ready') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      if (stopped) return
      const waiting = queue?.status === 'WAITING'
      const interval = waiting && queue.ahead <= 20 ? 4_000 : 8_000
      await sync(autoJoinRef.current)
      if (!stopped) timer = setTimeout(tick, interval)
    }
    timer = setTimeout(tick, autoJoinRef.current ? 4_000 : 6_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync(autoJoinRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase, queue, sync])

  const joinNow = useCallback(async () => {
    const t = tokenRef.current
    if (!t) {
      toast.error('Your device is not registered yet. Please reload the page.')
      return
    }
    setJoining(true)
    try {
      const { data } = await api<QueueApiResponse>('/api/public/queue/join', {
        method: 'POST',
        body: JSON.stringify({ token: t }),
      })
      if (!data) {
        toast.error('Could not join the queue. Please try again.')
        return
      }
      setVotingStatus(data.votingStatus)
      setClosedPermanently(data.closedPermanently)
      if (data.queue?.status === 'ADMITTED') {
        admit(data.queue.pass)
      } else if (data.queue?.status === 'WAITING') {
        setQueue({ status: 'WAITING', position: data.queue.position, ahead: data.queue.ahead, etaSeconds: data.queue.etaSeconds })
        toast.success('You are in line. Keep this page open!')
      } else if (data.votingStatus === 'PAUSED') {
        toast.info('Voting is paused right now. Your spot is saved if you were already in line.')
      } else {
        toast.info(data.closedPermanently ? 'Voting has ended.' : 'Voting is not open yet.')
      }
    } finally {
      setJoining(false)
    }
  }, [admit])

  // ------------------------------------------------------------------ render

  const open = votingStatus === 'OPEN'
  const paused = votingStatus === 'PAUSED'
  const closed = votingStatus === 'CLOSED'
  const admitted = queue?.status === 'ADMITTED'
  const waiting = queue?.status === 'WAITING'

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <main className="flex-1">
        <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-8 sm:pt-12">
          <header className="mb-6 text-center">
            <h1 className="sr-only">Voting lobby — Nepal Grand Tihar Festival 2026</h1>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 sm:text-sm">
                Voting lobby
              </p>
              <StatusBadge status={votingStatus} />
            </div>
          </header>

          {phase === 'loading' && (
            <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <Skeleton className="mx-auto h-5 w-40" />
              <Skeleton className="mx-auto h-16 w-3/4" />
              <Skeleton className="mx-auto h-4 w-2/3" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-10 text-center shadow-sm">
              <AlertCircle className="h-10 w-10 text-zinc-300" aria-hidden />
              <div>
                <p className="text-lg font-semibold text-zinc-900">Could not load the lobby</p>
                <p className="mt-1 text-base text-zinc-500">Check your connection and try again.</p>
              </div>
              <Button onClick={() => void initialize(autoJoinRef.current)} variant="outline" className="gap-2">
                <RotateCw className="h-4 w-4" aria-hidden />
                Retry
              </Button>
            </div>
          )}

          {phase === 'ready' && (
            <>
              {/* ------------------------------------- admitted */}
              {admitted ? (
                <section
                  aria-label="Admitted to voting"
                  className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 ring-1 ring-teal-600/20">
                    <PartyPopper className="h-8 w-8 text-teal-600" aria-hidden />
                  </span>
                  <h2 className="mt-5 text-2xl font-bold text-zinc-900">You&rsquo;re in!</h2>
                  <p className="mt-2 text-base text-zinc-600">Opening the voting page for you…</p>
                  <div className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
                    <RotateCw className="h-4 w-4 animate-spin" aria-hidden />
                    Please wait
                  </div>
                </section>
              ) : waiting && queue.status === 'WAITING' ? (
                /* ------------------------------------- waiting in line */
                <section aria-label="Queue status" className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 ring-1 ring-teal-600/20">
                    <Hourglass className="h-7 w-7 text-teal-600" aria-hidden />
                  </span>
                  <h2 className="mt-4 text-xl font-bold text-zinc-900 sm:text-2xl">You&rsquo;re in line</h2>
                  <p className="mt-1.5 text-base text-zinc-600">
                    Devices are let in in small groups to keep voting fast and fair.
                  </p>

                  <div className="mt-6 rounded-xl border border-teal-600/15 bg-teal-50/60 px-6 py-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Your place in line</p>
                    <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-teal-700 sm:text-6xl">
                      #{queue.position}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-teal-900/80">
                      <span className="inline-flex items-center gap-1.5">
                        <ListOrdered className="h-4 w-4" aria-hidden />
                        {queue.ahead} ahead of you
                      </span>
                      {formatEta(queue.etaSeconds) ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-4 w-4" aria-hidden />
                          {formatEta(queue.etaSeconds)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-500">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                    Keep this page open — we&rsquo;ll take you in automatically.
                  </p>

                  {paused ? (
                    <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-amber-600/20 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
                      <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
                      Voting is paused for a moment. Your spot in line is saved — no need to rejoin.
                    </div>
                  ) : null}
                </section>
              ) : (
                /* ------------------------------------- not in line */
                <section aria-label="Voting status" className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8">
                  {closed ? (
                    closedPermanently ? (
                      <>
                        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-zinc-200">
                          <Ticket className="h-7 w-7 text-zinc-400" aria-hidden />
                        </span>
                        <h2 className="mt-4 text-xl font-bold text-zinc-900 sm:text-2xl">Voting has ended</h2>
                        <p className="mt-2 text-base text-zinc-600">
                          Thank you to everyone who participated in the Nepal Grand Tihar Festival 2026.
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-zinc-200">
                          <Clock3 className="h-7 w-7 text-zinc-400" aria-hidden />
                        </span>
                        <h2 className="mt-4 text-xl font-bold text-zinc-900 sm:text-2xl">Voting is not open yet</h2>
                        <p className="mt-2 text-base text-zinc-600">
                          The organizer will open voting during the event. This page updates automatically — keep it
                          open and tap &ldquo;Vote now&rdquo; when it starts.
                        </p>
                      </>
                    )
                  ) : paused ? (
                    <>
                      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-600/20">
                        <AlertCircle className="h-7 w-7 text-amber-600" aria-hidden />
                      </span>
                      <h2 className="mt-4 text-xl font-bold text-zinc-900 sm:text-2xl">Voting is paused</h2>
                      <p className="mt-2 text-base text-zinc-600">
                        The organizer has paused voting briefly. This page updates automatically.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 ring-1 ring-teal-600/20">
                        <Ticket className="h-7 w-7 text-teal-600" aria-hidden />
                      </span>
                      <h2 className="mt-4 text-xl font-bold text-zinc-900 sm:text-2xl">Voting is open</h2>
                      <p className="mt-2 text-base text-zinc-600">
                        Tap below to take your place in line. As soon as it&rsquo;s your turn, the voting page opens
                        automatically.
                      </p>
                    </>
                  )}

                  <Button
                    onClick={() => void joinNow()}
                    disabled={!open || joining}
                    className={cn(
                      'mt-6 h-12 w-full rounded-xl text-base font-semibold shadow-sm sm:h-14 sm:text-lg',
                      open && 'bg-teal-600 hover:bg-teal-700'
                    )}
                  >
                    {joining ? (
                      'Joining…'
                    ) : open ? (
                      <>
                        Vote now
                        <ArrowRight className="ml-1 h-5 w-5" aria-hidden />
                      </>
                    ) : (
                      'Waiting for voting to open…'
                    )}
                  </Button>

                  <p className="mt-4 text-sm text-zinc-500">
                    One vote per device · Voting is anonymous
                  </p>
                </section>
              )}

              {/* ------------------------------------- explainer */}
              <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-600">
                <p className="font-semibold text-zinc-900">Why is there a line?</p>
                <p className="mt-1.5">
                  Hundreds of audience members tap &ldquo;Vote now&rdquo; at the same time. The queue lets devices in
                  in small groups so the voting page stays fast and every vote is counted reliably. Your spot is held
                  even if voting pauses briefly.
                </p>
              </div>

              <div className="mt-6 flex justify-center">
                <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">
                  ← Event home
                </Link>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ------------------------------------------------ sticky footer */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-between gap-1.5 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center sm:flex-row">
          <p className="text-xs text-zinc-500 sm:text-sm">Nepal Grand Tihar Festival 2026</p>
          <p className="text-xs text-zinc-500 sm:text-sm">Voting is anonymous · One vote per device</p>
        </div>
      </footer>
    </div>
  )
}
