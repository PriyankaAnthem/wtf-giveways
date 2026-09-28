import { notFound } from 'next/navigation'
import { AcquiredTestForm } from './acquired-test-form'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Acquired Test Checkout (Staging)',
  robots: { index: false, follow: false },
}

export default function AcquiredTestPage() {
  // Staging/Preview only. VERCEL_ENV is server-only, so the guard runs here.
  const isStaging =
    process.env.VERCEL_ENV === 'preview' ||
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').includes('staging.wtf-giveaways.co.uk')

  if (!isStaging) {
    notFound()
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Acquired Test Checkout</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Staging-only internal tool. Paste an existing checkout <code>ref</code> and create an
        Acquired test payment link. This does not allocate tickets, award instant wins, or confirm
        any payment.
      </p>
      <AcquiredTestForm />
    </main>
  )
}
