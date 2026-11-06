'use client'

import { useEffect, useState } from 'react'

/**
 * Live countdown to the end of the current voting round.
 *
 * `serverNow` is the server's clock at the time the status was fetched; the
 * difference to the device clock is applied so phones with a wrong clock
 * still show the right time. Returns remaining milliseconds (never below 0),
 * or null when there is no running round.
 */
export function useRoundCountdown(autoPauseAt: string | null | undefined, serverNow?: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  const [skew, setSkew] = useState<{ serverNow: string | null | undefined; offset: number }>({
    serverNow: undefined,
    offset: 0,
  })

  // Recompute the clock offset whenever a fresh server timestamp arrives
  // (adjusting state during render — no extra effect pass).
  if (skew.serverNow !== serverNow) {
    const server = serverNow ? Date.parse(serverNow) : NaN
    setSkew({ serverNow, offset: Number.isFinite(server) ? server - Date.now() : 0 })
  }

  useEffect(() => {
    if (!autoPauseAt) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 250)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [autoPauseAt])

  if (!autoPauseAt) return null
  const end = Date.parse(autoPauseAt)
  if (!Number.isFinite(end)) return null
  return Math.max(0, end - (now + skew.offset))
}

/** 4:05 style formatting for a millisecond duration. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
