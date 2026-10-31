/** Tiny TTL memory cache for hot public reads (participants, status). */
type Entry<T> = { value: T; expiresAt: number }

// Shared via globalThis so ALL route bundles in the process see the same
// cache (Next.js bundles shared modules per-route in dev).
const globalCache = globalThis as unknown as { __ngtfCache?: Map<string, Entry<unknown>> }
const store: Map<string, Entry<unknown>> = globalCache.__ngtfCache ?? new Map()
globalCache.__ngtfCache = store

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    store.delete(key)
    return undefined
  }
  return hit.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function cacheDelete(key: string): void {
  store.delete(key)
}

/** Invalidate everything cached about voting state / participants. */
export function invalidatePublicCaches(): void {
  store.delete('voting:status')
  store.delete('public:participants')
  store.delete('admin:overview')
}
