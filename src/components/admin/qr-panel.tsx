'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Download, QrCode, RefreshCw } from 'lucide-react'

/**
 * QR code generation & download. The QR encodes the public voting URL —
 * regenerate when the deployment URL changes.
 */
export function QrPanel() {
  const [url, setUrl] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [downloading, setDownloading] = useState<'png' | 'svg' | null>(null)

  // Default to the voting lobby on the current origin (works when reached via the public URL).
  useEffect(() => {
    if (!url && typeof window !== 'undefined') {
      setUrl(window.location.origin + '/')
    }
  }, [url])

  const valid = /^https?:\/\/.+/i.test(url.trim())
  const qrSrc = valid ? `/api/admin/qr?url=${encodeURIComponent(url.trim())}&format=png&size=640&t=${previewKey}` : null

  async function download(format: 'png' | 'svg') {
    if (!valid) return
    setDownloading(format)
    try {
      const res = await fetch(`/api/admin/qr?url=${encodeURIComponent(url.trim())}&format=${format}&size=2048`)
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `ngtf-2026-voting-qr.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
      toast.success(`QR code downloaded (${format.toUpperCase()}, ${format === 'png' ? '2048px' : 'vector'}).`)
    } catch {
      toast.error('Download failed. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4.5 w-4.5 text-brand-deep" aria-hidden />
          Voting QR code
        </CardTitle>
        <CardDescription className="text-xs">
          Print this code for the audience. Scanning it opens the ballot directly. QR codes printed earlier
          (pointing to /queue) still work: they redirect to the ballot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="mx-auto w-fit rounded-xl border border-line bg-white p-3 shadow-sm">
            {qrSrc ? (
              <img src={qrSrc} alt="Voting page QR code preview" width={220} height={220} className="h-[220px] w-[220px]" />
            ) : (
              <div className="flex h-[220px] w-[220px] items-center justify-center bg-surface text-xs text-ink-soft">
                Enter a valid URL
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="qr-url">Public voting URL</Label>
              <div className="flex gap-2">
                <Input
                  id="qr-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-domain.com/"
                  className="h-9"
                  inputMode="url"
                />
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Regenerate QR code" onClick={() => setPreviewKey((k) => k + 1)}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-ink-soft">
                Defaults to the current deployment URL. If you deploy under a different domain, update this field and
                regenerate — the QR encodes exactly what is shown here.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <Button onClick={() => void download('png')} disabled={!valid || downloading !== null} className="gap-2 rounded-full bg-brand font-semibold text-white hover:bg-[#00b0d8]">
                <Download className="h-4 w-4" aria-hidden />
                {downloading === 'png' ? 'Preparing…' : 'Download PNG (2048px)'}
              </Button>
              <Button onClick={() => void download('svg')} disabled={!valid || downloading !== null} variant="outline" className="gap-2">
                <Download className="h-4 w-4" aria-hidden />
                {downloading === 'svg' ? 'Preparing…' : 'Download SVG (vector)'}
              </Button>
            </div>

            <div className="rounded-lg border border-line bg-surface/60 p-3 text-[11px] leading-relaxed text-ink-soft">
              <p className="font-semibold text-ink">Printing tips</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Print at least 4 × 4 cm with quiet-zone margin so phone cameras can focus.</li>
                <li>Error correction level H — the code stays scannable even if partially covered.</li>
                <li>Test-scan with at least one iPhone and one Android phone before the event.</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
