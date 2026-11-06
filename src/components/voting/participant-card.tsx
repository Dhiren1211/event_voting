'use client'

import { memo } from 'react'
import { Check } from 'lucide-react'
import type { ParticipantPublic } from '@/lib/types'
import { cn } from '@/lib/utils'

export type VoteButtonState = 'open' | 'closed' | 'paused' | 'voted'

function initialsOf(name: string): string {
  return name
    .split(/\s+&\s+|\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** Participant photo, or a light initials tile until the admin uploads one. */
export function ParticipantPhoto({
  participant,
  className,
  eager = false,
}: {
  participant: Pick<ParticipantPublic, 'name' | 'photoUrl'> | undefined
  className?: string
  eager?: boolean
}) {
  return (
    <div className={cn('overflow-hidden bg-canvas-high', className)}>
      {participant?.photoUrl ? (
        <img
          src={participant.photoUrl}
          alt={participant.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover object-[50%_25%]"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center text-[28px] font-semibold tracking-wide text-[#a9c3d1]"
        >
          {participant ? initialsOf(participant.name) : ''}
        </span>
      )}
    </div>
  )
}

/**
 * Outlined ballot tile. The whole tile is the vote target (opens the
 * confirmation). The device's own vote is shown as the "selected" tile.
 */
export const ParticipantCard = memo(function ParticipantCard({
  participant,
  buttonState,
  submitting,
  onVote,
  isMyVote = false,
}: {
  participant: ParticipantPublic
  buttonState: VoteButtonState
  submitting: boolean
  onVote: (p: ParticipantPublic) => void
  isMyVote?: boolean
}) {
  const canVote = buttonState === 'open' && !submitting

  return (
    <li>
      <button
        type="button"
        onClick={() => onVote(participant)}
        disabled={!canVote}
        aria-label={canVote ? `Vote for ${participant.name}` : participant.name}
        className={cn(
          'group flex h-full w-full flex-col rounded-[4px] border-[1.5px] bg-white p-2 text-center transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default',
          isMyVote ? 'border-brand' : 'border-canvas-line',
          canVote && 'hover:border-brand active:bg-brand-soft',
          (buttonState === 'paused' || buttonState === 'closed') && 'opacity-60'
        )}
      >
        <div className="relative">
          <ParticipantPhoto participant={participant} className="aspect-square w-full rounded-[2px]" />
          {participant.classification === 'GROUP' ? (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
              Group
            </span>
          ) : null}
          {isMyVote ? (
            <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand ring-[3px] ring-white">
              <Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden />
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col px-1 pb-1 pt-3">
          <h3
            className={cn(
              'line-clamp-2 text-[14px] font-semibold leading-snug transition-colors',
              isMyVote ? 'text-brand-deep' : 'text-heading',
              canVote && 'group-hover:text-brand-deep'
            )}
          >
            {participant.name}
          </h3>
          {participant.performance ? (
            <p className="mt-0.5 truncate text-[12px] text-subtle">{participant.performance}</p>
          ) : null}
          {isMyVote ? (
            <p className="mt-1.5 text-[12px] font-semibold uppercase tracking-wide text-brand-deep">Your vote</p>
          ) : null}
        </div>
      </button>
    </li>
  )
})
