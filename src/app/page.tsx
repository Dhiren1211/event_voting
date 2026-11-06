import type { Metadata } from 'next'
import { VotingPage } from '@/components/voting/voting-page'
import { getPublicParticipants } from '@/lib/public-data'
import { getVotingState } from '@/lib/voting'

export const dynamic = 'force-dynamic'

// White ballot: match the phone's browser chrome to it.
export const viewport = { themeColor: '#ffffff' }

export const metadata: Metadata = {
  title: 'Vote — Nepal Grand Tihar Festival 2026',
  description: 'Audience choice voting for the Nepal Grand Tihar Festival 2026 talent show.',
}

/**
 * The QR code lands here. Participants and voting status are rendered into
 * the first HTML response (both served from a short in-memory cache), so the
 * ballot is visible immediately — no lobby, no loading spinner.
 */
export default async function Home() {
  const [participants, state] = await Promise.all([
    getPublicParticipants().catch(() => null),
    getVotingState().catch(() => null),
  ])
  return (
    <VotingPage
      initialParticipants={participants}
      initialStatus={
        state
          ? {
              status: state.status,
              closedPermanently: state.closedPermanently,
              autoPauseAt: state.autoPauseAt,
              serverNow: new Date().toISOString(),
            }
          : null
      }
    />
  )
}
