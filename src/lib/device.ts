import { createHash, randomBytes } from 'crypto'

/** Cryptographically secure URL-safe device token (256-bit entropy). */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Device tokens are 43-char base64url strings. */
export const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{40,80}$/

/** Tokens are stored only as SHA-256 hashes — the raw token never touches the DB. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isValidDeviceToken(token: string): boolean {
  return DEVICE_TOKEN_RE.test(token)
}
