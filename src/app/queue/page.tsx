import type { Metadata } from 'next'
import { QueueLobby } from '@/components/voting/queue-lobby'

export const metadata: Metadata = {
  title: 'Voting lobby — Nepal Grand Tihar Festival 2026',
  description: 'Check voting status and take your place in line for the 2026 talent show audience vote.',
}

export default function QueuePage() {
  return <QueueLobby />
}
