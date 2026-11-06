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
 * Runtime datasource detection + one-time tuning.
 *
 * SQLite URLs look like `file:./db/custom.db?connection_limit=1` and get the
 * PRAGMA tuning below (WAL journal: readers never block the writer;
 * synchronous=NORMAL avoids fsync-per-commit stalls; busy_timeout tolerates
 * brief lock contention; connection_limit=1 in .env serializes all writes,
 * making check-then-write vote flows atomic end to end).
 *
 * PostgreSQL/MySQL/etc. (Neon, Supabase, RDS, …) must NOT receive PRAGMAs —
 * they are SQLite-only statements and fail with a syntax error on other
 * engines (e.g. Postgres error 42601 "syntax error at or near PRAGMA").
 */
const isSqlite = (process.env.DATABASE_URL ?? '').trim().toLowerCase().startsWith('file:')

export function ensureDb(): Promise<void> {
  if (!globalForPrisma.dbReady) {
    globalForPrisma.dbReady = (async () => {
      if (!isSqlite) return // PostgreSQL/Neon — nothing to tune at startup.
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
