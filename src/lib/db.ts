
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

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

export function ensureDb(): Promise<void> {
  if (!globalForPrisma.dbReady) {
    globalForPrisma.dbReady = (async () => {
      const databaseUrl = process.env.DATABASE_URL ?? ''

      // Only execute SQLite PRAGMAs for SQLite.
      if (databaseUrl.trim().toLowerCase().startsWith('file:')) {
        await db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
        await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL')
        await db.$queryRawUnsafe('PRAGMA busy_timeout=5000')
      }
    })().catch((error) => {
      globalForPrisma.dbReady = undefined
      throw error
    })
  }

  return globalForPrisma.dbReady
}
