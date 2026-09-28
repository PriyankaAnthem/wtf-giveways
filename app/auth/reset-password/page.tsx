'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

type PageState = 'verifying' | 'ready' | 'expired' | 'success'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pageState, setPageState] = useState<PageState>('verifying')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    async function establishSession() {
      const supabase = createClient()

      try {
        // 1) If the URL has a ?code= param (PKCE flow), exchange it explicitly
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')

        if (code) {
          const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(window.location.href)
          if (exchangeErr) {
            console.error('[reset-password] Code exchange failed:', exchangeErr.message)
            setPageState('expired')
            return
          }
        }

        // 2) For hash-fragment flows (#access_token=...), the Supabase client
        //    auto-detects the token. We listen for the PASSWORD_RECOVERY event
        //    or fall back to checking getSession() after a short wait.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            setPageState('ready')
            subscription.unsubscribe()
          }
        })

        // 3) Also check immediately in case the session is already established
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          setPageState('ready')
          subscription.unsubscribe()
          return
        }

        // 4) Safety timeout: if nothing fires within 5s, it's expired
        setTimeout(() => {
          setPageState((current) => (current === 'verifying' ? 'expired' : current))
          subscription.unsubscribe()
        }, 5000)
      } catch (err) {
        console.error('[reset-password] Unexpected error:', err)
        setPageState('expired')
      }
    }

    establishSession()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    const supabase = createClient()
    setIsLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPageState('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred'
      if (msg.toLowerCase().includes('session') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expired')) {
        setPageState('expired')
      } else {
        setError(msg)
      }
    } finally {
      setIsLoading(false)
    }
  }

  // -- Verifying state --
  if (pageState === 'verifying') {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Verifying reset link...</CardTitle>
              <CardDescription>
                Please wait while we verify your password reset link.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    )
  }

  // -- Expired state --
  if (pageState === 'expired') {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Link expired</CardTitle>
              <CardDescription>
                This password reset link has expired or is invalid. Please request a new one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/auth/forgot-password">
                <Button className="w-full">Request new link</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // -- Success state --
  if (pageState === 'success') {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Password updated</CardTitle>
              <CardDescription>
                Your password has been reset successfully. You can now sign in with your new password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/auth/login">
                <Button className="w-full">Sign in</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // -- Ready: show password form --
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Reset password</CardTitle>
            <CardDescription>Enter your new password below.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Updating...' : 'Update password'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
