'use client'

import { useCallback, useEffect, useState } from 'react'
import { LoginForm } from '@/components/admin/login-form'
import { Dashboard } from '@/components/admin/dashboard'

type SessionState =
  | { phase: 'checking' }
  | { phase: 'anonymous' }
  | { phase: 'authenticated'; username: string }

export default function AdminPage() {
  const [state, setState] = useState<SessionState>({ phase: 'checking' })

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/session', { cache: 'no-store' })
      const data = await res.json()
      if (data?.authenticated) {
        setState({ phase: 'authenticated', username: data.username })
      } else {
        setState({ phase: 'anonymous' })
      }
    } catch {
      setState({ phase: 'anonymous' })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setState(data?.authenticated ? { phase: 'authenticated', username: data.username } : { phase: 'anonymous' })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'anonymous' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-600" aria-hidden />
          <p className="text-sm text-zinc-400">Checking session…</p>
        </div>
      </div>
    )
  }

  if (state.phase === 'anonymous') {
    return <LoginForm onSuccess={(username) => setState({ phase: 'authenticated', username })} />
  }

  return <Dashboard username={state.username} onLogout={checkSession} />
}
