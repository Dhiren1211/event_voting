export type ParticipantPublic = {
  id: number
  name: string
  performance: string | null
  category: string | null
  classification: 'SOLO' | 'GROUP' | null
  members: string | null
  affiliation: string | null
  photoUrl: string | null
}

export type VotingStatusInfo = {
  status: 'OPEN' | 'PAUSED' | 'CLOSED'
  closedPermanently: boolean
}

export type DeviceVoteState = {
  voted: boolean
  participantName: string | null
  votedAt: string | null
}

export type QueueClientState =
  | { status: 'WAITING'; position: number; ahead: number; etaSeconds: number | null }
  | { status: 'ADMITTED'; pass: string; expiresAt: string }

export type QueueApiResponse = {
  ok?: boolean
  votingStatus: VotingStatusInfo['status']
  closedPermanently: boolean
  queue: QueueClientState | null
}

export const CATEGORY_LABELS: Record<string, string> = {
  SINGING: 'Singing',
  DANCE: 'Dance',
  RAP: 'Rap',
  BEATBOXING: 'Beatboxing',
  INSTRUMENTAL: 'Instrumental',
  CULTURAL: 'Cultural Performance',
}

export const EVENT_INFO = {
  title: 'Nepal Grand Tihar Festival 2026',
  subtitle: 'Official Talent Show — Audience Choice Voting',
  organizer: 'Nepalese Community in Busan (NCB)',
  date: 'November 9, 2026',
  time: '4:00 PM – 9:00 PM',
  venue: 'Pukyong National University, Daeyeon Campus, University Theater (D21)',
}
