'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/voting/status-badge'
import type { VotingStatusInfo } from '@/lib/types'

/**
 * Landing-page call-to-action. Reflects the live voting status so the
 * organizer can pause / close voting without redeploying the landing page.
 */
export function LandingCta() {
  const [status, setStatus] = useState<VotingStatusInfo['status'] | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/public/status', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as VotingStatusInfo
        if (!cancelled && data) setStatus(data.status)
      } catch {
        /* keep previous state — landing falls back to the default CTA */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const open = status === 'OPEN'

  return (
    <div className="flex flex-col items-center gap-3">
      <StatusBadge status={status} />
      <Button
        asChild
        className="h-12 w-full max-w-xs rounded-xl bg-teal-600 px-8 text-base font-semibold shadow-sm hover:bg-teal-700 sm:w-auto"
      >
        <Link href="/vote">
          {open ? 'Vote now' : 'Go to voting page'}
          <ArrowRight className="ml-1 h-4.5 w-4.5" aria-hidden />
        </Link>
      </Button>
    </div>
  )
}
