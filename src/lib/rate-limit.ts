/**
 * Minimal in-memory sliding-window rate limiter.
 * Suitable for the single-instance deployment model of this event app.
 */
const globalRL = globalThis as unknown as { __ngtfRateBuckets?: Map<string, number[]> }
const buckets: Map<string, number[]> = globalRL.__ngtfRateBuckets ?? new Map()
globalRL.__ngtfRateBuckets = buckets

let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, hits] of buckets) {
    const alive = hits.filter((t) => now - t < 60_000)
    if (alive.length === 0) buckets.delete(key)
    else buckets.set(key, alive)
  }
}

/**
 * Returns true when the action is allowed.
 * @param key    unique bucket key, e.g. `vote:token:<hash>` or `vote:ip:<ip>`
 * @param limit  max events per window
 * @param windowMs window size in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()
  sweep(now)
  const hits = buckets.get(key) ?? []
  const recent = hits.filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    buckets.set(key, recent)
    return false
  }
  recent.push(now)
  buckets.set(key, recent)
  return true
}
