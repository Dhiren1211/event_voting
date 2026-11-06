'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { Wordmark } from '@/components/voting/public-shell'

export function LoginForm({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      toast.error('Please enter your username and password.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        onSuccess(data.username)
      } else if (res.status === 429) {
        toast.error('Too many login attempts. Please wait a minute and try again.')
      } else if (res.status === 401) {
        toast.error('Invalid username or password.')
      } else {
        toast.error(data?.message ?? data?.error ?? 'Login failed. Please try again.')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="absolute left-6 top-7 sm:left-10"><Wordmark /></div>
      <div aria-hidden className="bg-dots pointer-events-none fixed inset-0" />
      <Card className="relative w-full max-w-sm rounded-md border-[1.5px] border-line shadow-none">
        <CardHeader className="space-y-1.5 text-left">
          <p className="text-[15px] font-medium text-brand">Administrators</p>
          <CardTitle className="text-[26px] font-bold tracking-tight text-ink">Sign in</CardTitle>
          <CardDescription className="text-xs">
            Nepal Grand Tihar Festival 2026 · Secure administrative access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="admin-username">Username</Label>
              <Input
                id="admin-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                className="h-11 rounded-md"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="h-11 rounded-md"
              />
            </div>
            <Button type="submit" disabled={submitting} className="shadow-pill h-12 w-full gap-2 rounded-full text-[15px] font-semibold">
              <Lock className="h-4 w-4" aria-hidden />
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
