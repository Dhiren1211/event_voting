'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Building2, CheckCircle2, Users } from 'lucide-react'
import type { ParticipantPublic } from '@/lib/types'
import { CATEGORY_LABELS } from '@/lib/types'

function initialsOf(name: string): string {
  return name
    .split(/\s+&\s+|\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export type VoteButtonState = 'open' | 'closed' | 'paused' | 'voted'

interface ParticipantCardProps {
  participant: ParticipantPublic
  buttonState: VoteButtonState
  submitting: boolean
  onVote: (p: ParticipantPublic) => void
}

export const ParticipantCard = memo(function ParticipantCard({
  participant,
  buttonState,
  submitting,
  onVote,
}: ParticipantCardProps) {
  const canVote = buttonState === 'open'

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100">
        {participant.photoUrl ? (
          <img
            src={participant.photoUrl}
            alt={`Photo of ${participant.name}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div
            aria-label={`No photo available for ${participant.name}`}
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-50 to-zinc-200/70"
          >
            <span
              aria-hidden
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-xl font-semibold text-zinc-400 shadow-sm ring-1 ring-zinc-200"
            >
              {initialsOf(participant.name)}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Photo coming soon</span>
          </div>
        )}
        {participant.classification ? (
          <span className="absolute left-2.5 top-2.5">
            <Badge
              className={
                participant.classification === 'GROUP'
                  ? 'border-transparent bg-zinc-900/80 text-white backdrop-blur'
                  : 'border-transparent bg-white/90 text-zinc-700 backdrop-blur'
              }
            >
              {participant.classification === 'GROUP' ? 'Group' : 'Solo'}
            </Badge>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {participant.category ? (
            <Badge variant="secondary" className="bg-teal-50 text-teal-700 hover:bg-teal-50 border border-teal-600/10 font-medium">
              {CATEGORY_LABELS[participant.category] ?? participant.category}
            </Badge>
          ) : null}
          {participant.performance ? (
            <span className="text-sm font-medium text-zinc-500">{participant.performance}</span>
          ) : null}
        </div>

        <h3 className="text-lg font-semibold leading-snug text-zinc-900">{participant.name}</h3>

        {participant.affiliation ? (
          <p className="flex items-center gap-1.5 text-sm text-zinc-500">
            <Building2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            {participant.affiliation}
          </p>
        ) : null}

        {participant.members ? (
          <p className="flex items-start gap-1.5 text-sm leading-relaxed text-zinc-500">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <span className="line-clamp-2" title={participant.members}>
              {participant.members}
            </span>
          </p>
        ) : null}

        <div className="mt-auto pt-2">
          {buttonState === 'voted' ? (
            <Button disabled className="h-11 w-full gap-1.5 bg-zinc-100 text-base text-zinc-500 hover:bg-zinc-100">
              <CheckCircle2 className="h-4.5 w-4.5 text-teal-600" aria-hidden />
              Vote recorded
            </Button>
          ) : (
            <Button
              onClick={() => onVote(participant)}
              disabled={!canVote || submitting}
              className="h-11 w-full text-base font-semibold"
              aria-label={`Vote for ${participant.name}`}
            >
              {buttonState === 'paused' ? 'Voting is paused' : buttonState === 'closed' ? 'Voting closed' : 'Vote'}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
})
