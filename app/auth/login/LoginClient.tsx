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
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'

export default function LoginClient({
  redirect,
  signupHref = '/auth/sign-up',
}: {
  redirect: string
  signupHref?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error

      const urlRedirectRaw = new URLSearchParams(window.location.search).get('redirect')
      const urlRedirect = urlRedirectRaw ? decodeURIComponent(urlRedirectRaw) : null
      const candidate = (urlRedirect ?? redirect ?? '/me')
      const target = typeof candidate === 'string' && candidate.startsWith('/') ? candidate : '/me'
      console.log('[login] propRedirect=', redirect)
      console.log('[login] urlRedirectRaw=', urlRedirectRaw)
      console.log('[login] urlRedirectDecoded=', urlRedirect)
      console.log('[login] finalTarget=', target)
      window.location.href = target
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const description = redirect.startsWith('/admin')
    ? 'Sign in to continue to the admin area.'
    : 'Sign in to check your entries, tickets, and wins.'

  return (
    <Card className="border-purple-500/20">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin}>
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>

            <div className="flex flex-col gap-3 text-center">
              <p className="text-sm text-muted-foreground">New here?</p>
              <Link href={signupHref} className="block">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-purple-500 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
                >
                  Create your free account
                </Button>
              </Link>
              <Link href="/auth/forgot-password" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Forgot password?
              </Link>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
