import { randomBytes } from 'crypto'
import { db, ensureDb } from '@/lib/db'
import { sha256 } from '@/lib/device'
import { env } from '@/lib/env'
import { getVotingState, type VotingState } from '@/lib/voting'

/**
 * Virtual waiting room (admission queue) for the voting page.
 *
 * Goal: when many devices tap "Vote now" at the same moment, they join a FIFO
 * line instead of stampeding the voting page and the database. Devices are
 * admitted in small batches (QUEUE_ACTIVE_SLOTS concurrent passes) and each
 * admitted device receives a short-lived pass for /vote. When a device votes,
 * its slot is released immediately so the line keeps moving.
 *
 * Design notes:
 * - Single-process deployment: admission is serialized with an in-process
 *   async mutex and throttled to one run per ADMIT_MIN_INTERVAL_MS, so any
 *   number of concurrent pollers triggers at most a handful of DB cycles.
 * - Expired passes are purged on every cycle, automatically freeing slots.
 * - The organizer opening/closing voting clears the queue (see the admin
 *   voting-status route), so no stale devices from a previous session are
 *   admitted first.
 */

const ADMIT_MIN_INTERVAL_MS = 750

/** Average seconds a device needs on the voting page — used for the ETA estimate. */
const AVG_SERVICE_SECONDS = 45

export type QueuePublicState =
  | { status: 'WAITING'; position: number; ahead: number; etaSeconds: number | null }
  | { status: 'ADMITTED'; pass: string; expiresAt: string }

export type QueueResult = {
  votingStatus: VotingState['status']
  closedPermanently: boolean
  queue: QueuePublicState | null
}

// ---------------------------------------------------------------------------
// In-process mutex + throttle for the admission cycle
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __ngtfQueueChain?: Promise<void>
  __ngtfQueueLastAdmit?: number
  __ngtfQueueTrailing?: ReturnType<typeof setTimeout>
}

/**
 * Ensure a cycle runs right after the throttle window even if every poller
 * arrived inside it (classic trailing-edge throttle). Without this, a burst
 * of simultaneous "join" requests would upsert their entries while the first
 * cycle was already done, and nobody would trigger the next one until an
 * unrelated poll happened to arrive.
 */
function scheduleTrailingCycle(): void {
  if (g.__ngtfQueueTrailing) return
  g.__ngtfQueueTrailing = setTimeout(() => {
    g.__ngtfQueueTrailing = undefined
    void runAdmissionCycle()
  }, ADMIT_MIN_INTERVAL_MS)
  g.__ngtfQueueTrailing.unref?.()
}

async function runAdmissionCycle(): Promise<void> {
  const now = Date.now()
  if (g.__ngtfQueueLastAdmit && now - g.__ngtfQueueLastAdmit < ADMIT_MIN_INTERVAL_MS) {
    scheduleTrailingCycle()
    return
  }

  // Serialize concurrent cycles (single process).
  const prev = g.__ngtfQueueChain ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  g.__ngtfQueueChain = prev.then(() => gate)
  await prev // wait for the previous cycle

  try {
    const fresh = Date.now()
    if (g.__ngtfQueueLastAdmit && fresh - g.__ngtfQueueLastAdmit < ADMIT_MIN_INTERVAL_MS) {
      scheduleTrailingCycle()
      return
    }
    g.__ngtfQueueLastAdmit = fresh

    const passTtlMs = env.queuePassTtlMin * 60_000

    // 1. Free slots held by passes that expired.
    await db.queueEntry.deleteMany({
      where: { status: 'ADMITTED', passExpiresAt: { lt: new Date() } },
    })

    // 2. Admit the oldest waiting devices into every free slot.
    const active = await db.queueEntry.count({ where: { status: 'ADMITTED' } })
    const slots = Math.max(0, env.queueActiveSlots - active)
    if (slots === 0) return

    const next = await db.queueEntry.findMany({
      where: { status: 'WAITING' },
      orderBy: { enqueuedAt: 'asc' },
      take: slots,
      select: { id: true, tokenHash: true },
    })

    if (next.length === 0) return

    const expiresAt = new Date(Date.now() + passTtlMs)
    const nowIso = new Date()
    // One transaction for the whole batch: with large slot counts a burst can
    // admit hundreds of devices at once, and one commit is far cheaper than
    // hundreds of separate SQLite commits. updateMany (not update) so a device
    // purged concurrently simply matches 0 rows instead of failing the batch.
    await db
      .$transaction(
        next.map((entry) =>
          db.queueEntry.updateMany({
            where: { id: entry.id, status: 'WAITING' },
            data: {
              status: 'ADMITTED',
              admittedAt: nowIso,
              passToken: randomBytes(24).toString('base64url'),
              passExpiresAt: expiresAt,
            },
          })
        )
      )
      .catch((e) => console.error('queue admission batch failed', e))
  } finally {
    release()
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

function etaSecondsFor(ahead: number): number | null {
  if (ahead <= 0) return 0
  const perMinute = Math.max(1, (env.queueActiveSlots * 60) / AVG_SERVICE_SECONDS)
  return Math.ceil((ahead / perMinute) * 60)
}

async function readEntry(tokenHash: string) {
  return db.queueEntry.findUnique({ where: { tokenHash } })
}

async function toPublicState(entry: {
  status: string
  enqueuedAt: Date
  passToken: string | null
  passExpiresAt: Date | null
}): Promise<QueuePublicState | null> {
  if (entry.status === 'ADMITTED' && entry.passToken && entry.passExpiresAt && entry.passExpiresAt > new Date()) {
    return { status: 'ADMITTED', pass: entry.passToken, expiresAt: entry.passExpiresAt.toISOString() }
  }
  if (entry.status !== 'WAITING') return null

  const ahead = await db.queueEntry.count({
    where: { status: 'WAITING', enqueuedAt: { lt: entry.enqueuedAt } },
  })
  return {
    status: 'WAITING',
    position: ahead + 1,
    ahead,
    etaSeconds: etaSecondsFor(ahead),
  }
}

/**
 * Join (or re-join) the queue for a device. Joining is only possible while
 * voting is OPEN; while PAUSED/CLOSED the current state is returned so the
 * lobby can explain what is happening. Existing entries are never lost here.
 */
export async function joinQueue(token: string): Promise<QueueResult> {
  await ensureDb()
  const state = await getVotingState()
  const base: QueueResult = {
    votingStatus: state.status,
    closedPermanently: state.closedPermanently,
    queue: null,
  }
  if (state.status !== 'OPEN') return base

  const tokenHash = sha256(token)

  // One queue slot per device. An expired ADMITTED entry is sent to the back
  // of the line (the user did not use their pass in time).
  await db.queueEntry.upsert({
    where: { tokenHash },
    update: {
      status: 'WAITING',
      enqueuedAt: new Date(),
      admittedAt: null,
      passToken: null,
      passExpiresAt: null,
    },
    create: { tokenHash },
  })

  await runAdmissionCycle()

  const entry = await readEntry(tokenHash)
  if (!entry) return base
  return { ...base, queue: await toPublicState(entry) }
}

/**
 * Current queue state for a device. Passes through the admission cycle
 * (throttled) so waiting devices are moved forward as slots free up.
 * A lapsed pass is re-queued automatically.
 */
export async function queueState(token: string): Promise<QueueResult> {
  await ensureDb()
  const state = await getVotingState()
  const base: QueueResult = {
    votingStatus: state.status,
    closedPermanently: state.closedPermanently,
    queue: null,
  }

  const tokenHash = sha256(token)
  let entry = await readEntry(tokenHash)
  if (!entry) return base

  // Pass expired while the user was waiting on the lobby page — re-queue.
  if (entry.status === 'ADMITTED' && entry.passExpiresAt && entry.passExpiresAt <= new Date()) {
    entry = await db.queueEntry.update({
      where: { tokenHash },
      data: { status: 'WAITING', enqueuedAt: new Date(), admittedAt: null, passToken: null, passExpiresAt: null },
    })
  }

  if (state.status === 'OPEN' && entry.status === 'WAITING') {
    await runAdmissionCycle()
    entry = await readEntry(tokenHash)
    if (!entry) return base
  }

  return { ...base, queue: await toPublicState(entry) }
}

/**
 * Validate an admission pass for a device (server-side gate used by /vote).
 * A valid, unexpired pass bound to this exact device token is required.
 */
export async function hasValidPass(token: string, pass: string): Promise<boolean> {
  const entry = await db.queueEntry.findUnique({ where: { tokenHash: sha256(token) } })
  return !!(
    entry &&
    entry.status === 'ADMITTED' &&
    entry.passToken === pass &&
    entry.passExpiresAt &&
    entry.passExpiresAt > new Date()
  )
}

/**
 * Release a device's queue slot (called right after a successful vote) so
 * the next devices in line are admitted without waiting for the pass TTL.
 */
export async function releaseQueueSlot(token: string): Promise<void> {
  await db.queueEntry.deleteMany({ where: { tokenHash: sha256(token) } }).catch(() => {})
}

/** Drop every queue entry — used when the organizer opens or closes voting. */
export async function clearQueue(): Promise<void> {
  await db.queueEntry.deleteMany({}).catch(() => {})
}
