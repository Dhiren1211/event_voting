'use client'

/** Admin API client — same-origin fetch with cookies, uniform error handling. */

export type AdminParticipant = {
  id: number
  name: string
  performance: string | null
  category: string | null
  classification: 'SOLO' | 'GROUP' | null
  members: string | null
  affiliation: string | null
  photoUrl: string | null
  sortOrder: number
  isActive: boolean
  needsReview: boolean
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  votes: number
}

export type OverviewData = {
  status: 'OPEN' | 'PAUSED' | 'CLOSED'
  closedPermanently: boolean
  oneVotePerIp: boolean
  openedAt: string | null
  closedAt: string | null
  autoPauseAt: string | null
  roundMinutes: number
  serverNow?: string
  totalVotes: number
  participantCount: number
  activeParticipantCount: number
  votesLastMinute: number
  votesLast5Minutes: number
  votesLastHour: number
  lastVoteAt: string | null
  results: { participantId: number; name: string; category: string | null; classification: string | null; isActive: boolean; votes: number }[]
}

export type AuditEntry = {
  id: number
  action: string
  actor: string | null
  details: string | null
  ip: string | null
  createdAt: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string
  ) {
    super(message ?? code)
  }
}

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  let data: (T & { ok?: boolean; error?: string; message?: string }) | null = null
  try {
    data = await res.json()
  } catch {
    // non-JSON response
  }
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError(res.status, data?.error ?? 'REQUEST_FAILED', data?.message)
  }
  return data as T
}
