'use client'

import { Badge } from '@/components/ui/badge'
import type { VotingStatusInfo } from '@/lib/types'

export function StatusBadge({ status }: { status: VotingStatusInfo['status'] | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1.5 border-zinc-200 text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 animate-pulse" />
        Checking…
      </Badge>
    )
  }
  if (status === 'OPEN') {
    return (
      <Badge className="gap-1.5 border-transparent bg-teal-50 text-teal-700 hover:bg-teal-50 ring-1 ring-inset ring-teal-600/20">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-600" />
        </span>
        Voting is open
      </Badge>
    )
  }
  if (status === 'PAUSED') {
    return (
      <Badge className="gap-1.5 border-transparent bg-amber-50 text-amber-700 hover:bg-amber-50 ring-1 ring-inset ring-amber-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Voting paused
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1.5 border-zinc-200 bg-zinc-50 text-zinc-600">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
      Voting closed
    </Badge>
  )
}
