import type { Metadata } from 'next'
import { VotingPage } from '@/components/voting/voting-page'

export const metadata: Metadata = {
  title: 'Vote now — Nepal Grand Tihar Festival 2026',
  description: 'Cast your single audience-choice vote for the 2026 talent show. One vote per device, no app or sign-up required.',
}

export default function VotePage() {
  return <VotingPage />
}
