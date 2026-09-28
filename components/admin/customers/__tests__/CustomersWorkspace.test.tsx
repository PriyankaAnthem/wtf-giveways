// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

// --- next/navigation ---
const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/admin/customers',
}))

// --- toast (used by the Newest list) ---
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { CustomersWorkspace } from '../CustomersWorkspace'

/** Classify a fetched URL into one of the three views. Order matters: the
 *  sub-routes contain the newest path as a prefix, so test them first. */
function classify(url: string): 'top-spenders' | 'recent-winners' | 'newest' | 'other' {
  if (url.includes('/api/admin/customers/top-spenders')) return 'top-spenders'
  if (url.includes('/api/admin/customers/recent-winners')) return 'recent-winners'
  if (url.includes('/api/admin/customers')) return 'newest'
  return 'other'
}

function countsByView() {
  const counts = { newest: 0, 'top-spenders': 0, 'recent-winners': 0, other: 0 }
  for (const call of (global.fetch as any).mock.calls) {
    counts[classify(String(call[0]))]++
  }
  return counts
}

beforeEach(() => {
  // Radix UI primitives expect these to exist in jsdom.
  ;(global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!window.matchMedia) {
    ;(window as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
  }

  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, customers: [], winners: [], hasNext: false, nextCursor: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CustomersWorkspace — lazy single-view fetching', () => {
  it('defaults to Newest and fetches ONLY the newest (V3) API', async () => {
    render(<CustomersWorkspace initialView="newest" />)
    await waitFor(() => expect((global.fetch as any).mock.calls.length).toBeGreaterThan(0))

    const counts = countsByView()
    expect(counts.newest).toBeGreaterThan(0)
    expect(counts['top-spenders']).toBe(0)
    expect(counts['recent-winners']).toBe(0)
  })

  it('honours an initial view of top-spenders and fetches ONLY that API', async () => {
    render(<CustomersWorkspace initialView="top-spenders" />)
    await waitFor(() => expect(countsByView()['top-spenders']).toBeGreaterThan(0))

    const counts = countsByView()
    expect(counts.newest).toBe(0)
    expect(counts['recent-winners']).toBe(0)
  })

  it('switching Newest -> Top Spenders fetches only top-spenders and never prefetches winners', async () => {
    render(<CustomersWorkspace initialView="newest" />)
    await waitFor(() => expect(countsByView().newest).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('tab', { name: /top spenders/i }))
    await waitFor(() => expect(countsByView()['top-spenders']).toBeGreaterThan(0))

    // No recent-winners request was ever issued (no hidden prefetch).
    expect(countsByView()['recent-winners']).toBe(0)
    // The URL was made addressable.
    expect(replace).toHaveBeenCalledWith('/admin/customers?view=top-spenders', { scroll: false })
  })

  it('switching to Recent Winners fetches only the recent-winners API', async () => {
    render(<CustomersWorkspace initialView="newest" />)
    await waitFor(() => expect(countsByView().newest).toBeGreaterThan(0))

    const newestCallsBefore = countsByView().newest

    fireEvent.click(screen.getByRole('tab', { name: /recent winners/i }))
    await waitFor(() => expect(countsByView()['recent-winners']).toBeGreaterThan(0))

    // Newest was not re-fetched after unmount; top-spenders never fetched.
    expect(countsByView().newest).toBe(newestCallsBefore)
    expect(countsByView()['top-spenders']).toBe(0)
  })

  it('returning to the default view writes a clean URL (no ?view=)', async () => {
    render(<CustomersWorkspace initialView="top-spenders" />)
    await waitFor(() => expect(countsByView()['top-spenders']).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('tab', { name: /newest/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/customers', { scroll: false }))
  })
})
