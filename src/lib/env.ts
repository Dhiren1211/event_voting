/** Typed environment access with safe defaults (server-side only). */

function int(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const env = {
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // rate limits — per minute
  votePerToken: int(process.env.VOTE_RATE_LIMIT_PER_TOKEN, 5),
  votePerIp: int(process.env.VOTE_RATE_LIMIT_PER_IP, 6000),
  devicePerIp: int(process.env.DEVICE_RATE_LIMIT_PER_IP, 3000),
  publicReadPerIp: int(process.env.PUBLIC_READ_RATE_LIMIT_PER_IP, 6000),
  loginPerIp: int(process.env.LOGIN_RATE_LIMIT_PER_IP, 10),

  // voting queue (virtual waiting room)
  queueJoinPerToken: int(process.env.QUEUE_JOIN_RATE_LIMIT_PER_TOKEN, 10),
  queueStatePerToken: int(process.env.QUEUE_STATE_RATE_LIMIT_PER_TOKEN, 60),
  queuePerIp: int(process.env.QUEUE_RATE_LIMIT_PER_IP, 6000),
  queueActiveSlots: int(process.env.QUEUE_ACTIVE_SLOTS, 40),
  queuePassTtlMin: int(process.env.QUEUE_PASS_TTL_MIN, 10),

  // uploads
  uploadDir: process.env.UPLOAD_DIR || '/home/z/my-project/uploads',
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 5),
} as const

export const SESSION_COOKIE = 'ngtf_admin_session'
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24h
