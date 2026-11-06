'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { StatusBadge, StatusBar } from '@/components/voting/status-badge'
import type { VotingStatusInfo } from '@/lib/types'
import { EVENT_INFO } from '@/lib/types'

/** Header + footer shared by the public ballot pages (light, airy, cyan accent). */
export function PublicShell({
  status,
  children,
}: {
  status: VotingStatusInfo['status'] | null
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas text-heading">
      <div aria-hidden className="bg-dots pointer-events-none fixed inset-0" />
      <StatusBar status={status} />
      <header className="relative">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            <Wordmark />
          </Link>
          <StatusBadge status={status} />
        </div>
      </header>
      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-2 sm:px-6">{children}</main>
      <footer className="relative">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[12px] leading-relaxed text-subtle sm:px-6">
          {EVENT_INFO.organizer} · {EVENT_INFO.date}
        </div>
      </footer>
    </div>
  )
}

/** Two-tone, letter-spaced event wordmark. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`whitespace-nowrap text-[15px] tracking-[0.2em] sm:text-[16px] ${className}`}>
      <span className="font-medium text-heading">TIHAR</span>
      <span className="font-bold text-brand">VOTE</span>
      <span className="ml-2 align-middle text-[11px] font-medium tracking-[0.12em] text-subtle">2026</span>
    </span>
  )
}

/** Compact NCB monogram (admin header). */
export function NcbMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={
        size === 'lg'
          ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-bold tracking-wide text-white'
          : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold tracking-wide text-white'
      }
    >
      NCB
    </span>
  )
}
