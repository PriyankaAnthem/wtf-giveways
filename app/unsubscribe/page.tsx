import type { Metadata } from 'next'
import { parseUnsubscribeToken, maskEmail } from '@/lib/marketing/unsubscribe-token'
import { UnsubscribeConfirm } from './unsubscribe-confirm'

export const runtime = 'nodejs'
// Never cache: the page reflects a per-recipient token and one-click action.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Unsubscribe | WTF Competitions',
  description: 'Manage your marketing email preferences.',
  robots: { index: false, follow: false },
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  // Parse + authenticate the token entirely server-side. An invalid, missing,
  // tampered, or malformed token reveals NOTHING about any customer — we only
  // ever surface a masked email for a token that decrypts and authenticates.
  const payload = token ? parseUnsubscribeToken(token) : null
  const maskedEmail = payload ? maskEmail(payload.emailLc) : null

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-balance">Email preferences</h1>

        {payload && token ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
              You&apos;re about to unsubscribe{' '}
              <span className="font-medium text-foreground">{maskedEmail}</span> from WTF
              Competitions marketing emails. You&apos;ll still receive essential emails about your
              account and orders.
            </p>
            <UnsubscribeConfirm token={token} />
          </>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            This unsubscribe link is invalid or has expired. To manage your email preferences, sign
            in and visit your account settings.
          </p>
        )}
      </div>
    </main>
  )
}
