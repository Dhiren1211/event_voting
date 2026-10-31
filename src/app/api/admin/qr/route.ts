import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { getAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * High-resolution voting QR code (admin-only).
 * ?url=https://...  – target public voting URL (validated http/https)
 * ?format=png|svg   – export format
 * ?size=256..2048   – PNG width in px (default 1024)
 */
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req)
  if (!admin) return jsonError('UNAUTHORIZED', 401)

  const url = req.nextUrl.searchParams.get('url') ?? ''
  const format = req.nextUrl.searchParams.get('format') === 'svg' ? 'svg' : 'png'
  const sizeParam = Number(req.nextUrl.searchParams.get('size') ?? 1024)
  const size = Math.min(Math.max(Number.isFinite(sizeParam) ? sizeParam : 1024, 256), 2048)

  // Only http(s) URLs are encoded — prevents javascript: or data: payloads.
  let parsed: URL
  try {
    parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol')
  } catch {
    return jsonError('INVALID_URL', 400)
  }

  const QRCode = (await import('qrcode')).default
  const options = {
    errorCorrectionLevel: 'H' as const,
    margin: 3,
    color: { dark: '#18181b', light: '#ffffff' },
  }

  if (format === 'svg') {
    const svg = await QRCode.toString(parsed.toString(), { type: 'svg', ...options })
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': `attachment; filename="ngtf-2026-voting-qr.svg"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const png = await QRCode.toBuffer(parsed.toString(), { ...options, width: size })
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="ngtf-2026-voting-qr.png"`,
      'Cache-Control': 'no-store',
    },
  })
}
