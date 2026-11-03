import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, Clock, MapPin } from 'lucide-react'
import { LandingCta } from '@/components/voting/landing-status'
import { EVENT_INFO } from '@/lib/types'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Nepal Grand Tihar Festival 2026 — Audience Choice Voting',
  description:
    'Official audience choice voting for the Nepal Grand Tihar Festival 2026 talent show, organized by the Nepalese Community in Busan (NCB). Vote from your phone — no app, no sign-up.',
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* ------------------------------------------------ top bar */}
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2.5 px-4 sm:px-6">
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-[10px] font-bold leading-none tracking-wide whitespace-nowrap text-white"
          >
            NCB
          </span>
          <p className="truncate text-xs font-semibold text-zinc-800 sm:text-sm">{EVENT_INFO.title}</p>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------ hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-teal-50/70 via-white to-white" />
          <div className="relative mx-auto w-full max-w-5xl px-4 pb-12 pt-12 text-center sm:px-6 sm:pb-16 sm:pt-20">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">
              {EVENT_INFO.subtitle}
            </p>
            <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-5xl sm:leading-[1.12]">
              {EVENT_INFO.title}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-500 sm:text-base">
              Organized by {EVENT_INFO.organizer}. Open the voting page on your phone, pick your favorite
              performance, and confirm — no app installation, no sign-up.
            </p>
            <div className="mt-7 flex justify-center">
              <LandingCta />
            </div>
            <p className="mt-5 text-[11px] text-zinc-400">One vote per device · Voting is anonymous</p>
          </div>
        </section>

        {/* ------------------------------------------------ event details */}
        <section aria-labelledby="event-details-heading" className="border-y border-zinc-100 bg-zinc-50/70">
          <div className="mx-auto w-full max-w-5xl px-4 py-9 sm:px-6 sm:py-12">
            <h2 id="event-details-heading" className="sr-only">
              Event details
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Detail
                icon={<CalendarDays className="h-4.5 w-4.5" aria-hidden />}
                label="Date"
                value={EVENT_INFO.date}
              />
              <Detail
                icon={<Clock className="h-4.5 w-4.5" aria-hidden />}
                label="Time"
                value={EVENT_INFO.time}
              />
              <Detail
                icon={<MapPin className="h-4.5 w-4.5" aria-hidden />}
                label="Venue"
                value={EVENT_INFO.venue}
                className="sm:col-span-3"
              />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ how it works */}
        <section aria-labelledby="how-it-works-heading" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <h2
            id="how-it-works-heading"
            className="text-center text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl"
          >
            How voting works
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Step
              number="1"
              title="Open the voting page"
              description="Scan the QR code placed on your table, or tap “Vote now” above."
            />
            <Step
              number="2"
              title="Pick one performance"
              description="Browse the participant list and choose the act you want to support."
            />
            <Step
              number="3"
              title="Confirm — that’s it"
              description="Each device can vote once. Your choice is final and stays anonymous."
            />
          </div>
        </section>
      </main>

      {/* ------------------------------------------------ sticky footer */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:flex-row sm:px-6">
          <p className="text-xs text-zinc-500">© 2026 {EVENT_INFO.organizer}</p>
          <p className="text-[11px] text-zinc-400">
            <Link href="/vote" className="font-medium text-teal-700 hover:text-teal-800">
              Vote now
            </Link>
            {' · '}Voting is anonymous · One vote per device
          </p>
        </div>
      </footer>
    </div>
  )
}

function Detail({
  icon,
  label,
  value,
  className,
}: {
  icon: ReactNode
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm', className)}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-600/15">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="mt-0.5 text-sm font-medium leading-snug text-zinc-900">{value}</p>
      </div>
    </div>
  )
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700 ring-1 ring-teal-600/20">
          {number}
        </span>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">{description}</p>
    </div>
  )
}
