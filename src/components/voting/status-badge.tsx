'use client'

import type { VotingStatusInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

type Status = VotingStatusInfo['status'] | null

const LABEL: Record<NonNullable<Status> | 'LOADING', string> = {
  OPEN: 'Voting open',
  PAUSED: 'Paused',
  CLOSED: 'Voting closed',
  LOADING: 'Checking…',
}

/** Outlined live-status pill. Cyan is used only when voting is open. */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const key = status ?? 'LOADING'
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-[1.5px] bg-white px-4 text-[13px] font-semibold sm:px-5',
        key === 'OPEN' && 'border-brand text-brand-deep',
        key === 'PAUSED' && 'border-canvas-line text-heading',
        (key === 'CLOSED' || key === 'LOADING') && 'border-canvas-line text-subtle',
        className
      )}
    >
      <span aria-hidden className="relative flex h-2 w-2">
        {key === 'OPEN' ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            'relative h-2 w-2 rounded-full',
            key === 'OPEN' && 'bg-brand',
            key === 'PAUSED' && 'bg-subtle',
            key === 'CLOSED' && 'bg-canvas-line',
            key === 'LOADING' && 'animate-pulse bg-canvas-line'
          )}
        />
      </span>
      {LABEL[key]}
    </span>
  )
}

/** Thin bar across the top of every public page: cyan while voting is open. */
export function StatusBar({ status }: { status: Status }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative h-1 w-full transition-colors duration-700 motion-reduce:transition-none',
        status === 'OPEN' ? 'bg-brand' : 'bg-transparent'
      )}
    />
  )
}
