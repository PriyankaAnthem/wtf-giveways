import { Suspense } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import LoginClient from './LoginClient'
import { safeInternalPath } from '@/lib/auth/safe-redirect'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirect?: string }>
}) {
  const params = await searchParams
  let redirectTo = '/me'
  // Only set when an explicit, safe internal redirect was supplied — this is
  // what we forward on to sign-up so a checkout journey survives Login → Create
  // account. A normal login (no redirect) leaves this null.
  let explicitRedirect: string | null = null
  if (typeof params?.redirect === 'string') {
    try {
      const safe = safeInternalPath(decodeURIComponent(params.redirect))
      if (safe) {
        redirectTo = safe
        explicitRedirect = safe
      }
    } catch {
      // malformed URI — keep default /me
    }
  }

  // Forward the return destination to sign-up only when one actually exists.
  const signupHref = explicitRedirect
    ? `/auth/sign-up?redirect=${encodeURIComponent(explicitRedirect)}`
    : '/auth/sign-up'

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-gradient-to-b from-purple-950/20 to-background p-6 md:p-10">
      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <Card>
              <CardHeader>
                <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Loading...</p>
              </CardContent>
            </Card>
          }
        >
          <LoginClient redirect={redirectTo} signupHref={signupHref} />
        </Suspense>
      </div>
    </div>
  )
}
