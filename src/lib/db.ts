import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  dbReady: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * One-time SQLite tuning for high-concurrency voting:
 * - WAL journal: readers never block the writer, commits are durable.
 * - synchronous=NORMAL: safe in WAL mode, avoids fsync-per-commit stalls.
 * - busy_timeout: tolerate brief lock contention instead of failing.
 * - The .env uses connection_limit=1 so all transactions are fully
 *   serialized — making check-then-write vote flows atomic end to end.
 */
export function ensureDb(): Promise<void> {
  if (!globalForPrisma.dbReady) {
    globalForPrisma.dbReady = (async () => {
      // PRAGMAs return rows on SQLite → queryRawUnsafe (not executeRawUnsafe).
      await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
      await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
      await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
    })().catch((e) => {
      globalForPrisma.dbReady = undefined
      throw e
    })
  }
  return globalForPrisma.dbReady
}
