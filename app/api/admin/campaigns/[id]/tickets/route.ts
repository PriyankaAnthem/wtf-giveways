import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache' } }
const PAGE_SIZE = 100
// Hard safety ceiling: never export more than this many tickets in one request.
const MAX_EXPORT_TICKETS = 100_000

const CSV_COLUMNS = [
  'Ticket Number',
  'First Name',
  'Last Name',
  'Email',
  'Mobile',
  'Order Reference',
  'Purchased UK',
] as const

// Escape a single CSV field per RFC 4180: wrap in quotes if it contains
// a comma, quote, or line break, and double any embedded quotes.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// Format an ISO timestamp in Europe/London as DD/MM/YYYY HH:MM:SS.
function formatPurchasedUk(iso: unknown): string {
  if (!iso) return ''
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function slugifyFilename(title: string): string {
  const base = (title || 'campaign')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'campaign'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Admin-only. Hosts (ops) and read_only are rejected.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'Missing campaign id' }, { status: 400, ...NO_STORE })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/campaign-tickets] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format')

  // ---- CSV export branch (only when explicitly requested) ----
  if (format === 'csv') {
    try {
      // Fetch the campaign title for the filename (does NOT touch ticket tables).
      let campaignTitle = 'campaign'
      const { data: campaignRow } = await svc
        .from('campaigns')
        .select('title')
        .eq('id', campaignId)
        .maybeSingle()
      if (campaignRow?.title) campaignTitle = campaignRow.title

      const lines: string[] = []
      lines.push(CSV_COLUMNS.map(csvField).join(','))

      let page = 1
      let totalTicketsSold = Infinity
      let fetched = 0

      // Sequentially page through the SAME RPC in 100-row chunks until we've
      // collected every sold ticket. Never request more than 100 at once.
      while (fetched < totalTicketsSold) {
        const { data, error } = await svc.rpc('get_campaign_tickets_page', {
          p_campaign_id: campaignId,
          p_page: page,
          p_page_size: PAGE_SIZE,
        })

        if (error) {
          console.error('[admin/campaign-tickets][csv] RPC error:', error.message)
          return NextResponse.json(
            { ok: false, error: 'Failed to export tickets' },
            { status: 500, ...NO_STORE },
          )
        }

        const rows = Array.isArray(data) ? data : []
        if (page === 1) {
          totalTicketsSold = rows.length > 0 ? Number(rows[0].total_tickets_sold ?? 0) : 0
          // Enforce the hard safety maximum before doing any heavy work.
          if (totalTicketsSold > MAX_EXPORT_TICKETS) {
            return NextResponse.json(
              {
                ok: false,
                error: `Export too large: ${totalTicketsSold.toLocaleString(
                  'en-GB',
                )} tickets exceeds the ${MAX_EXPORT_TICKETS.toLocaleString('en-GB')} limit.`,
              },
              { status: 413, ...NO_STORE },
            )
          }
          if (totalTicketsSold === 0) break
        }

        if (rows.length === 0) break

        for (const r of rows as any[]) {
          lines.push(
            [
              csvField(r.ticket_number),
              csvField(r.first_name),
              csvField(r.last_name),
              csvField(r.email),
              csvField(r.mobile),
              csvField(r.order_reference),
              csvField(formatPurchasedUk(r.purchased_at)),
            ].join(','),
          )
        }

        fetched += rows.length
        page += 1

        // Extra guard against runaway loops.
        if (page > Math.ceil(MAX_EXPORT_TICKETS / PAGE_SIZE) + 1) break
      }

      // UTF-8 BOM so Excel renders accented names correctly.
      const csvBody = '\uFEFF' + lines.join('\r\n') + '\r\n'
      const filename = `${slugifyFilename(campaignTitle)}-tickets.csv`

      return new NextResponse(csvBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (err: any) {
      console.error('[admin/campaign-tickets][csv] Unexpected error:', err?.message || err)
      return NextResponse.json(
        { ok: false, error: 'Internal server error' },
        { status: 500, ...NO_STORE },
      )
    }
  }

  // ---- Normal paginated JSON branch ----
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))

  try {
    // SINGLE data call: the existing RPC handles all joins/pagination server-side.
    const { data, error } = await svc.rpc('get_campaign_tickets_page', {
      p_campaign_id: campaignId,
      p_page: page,
      p_page_size: PAGE_SIZE,
    })

    if (error) {
      console.error('[admin/campaign-tickets] RPC error:', error.message)
      return NextResponse.json({ ok: false, error: 'Failed to fetch tickets' }, { status: 500, ...NO_STORE })
    }

    const rows = Array.isArray(data) ? data : []
    const totalTicketsSold = rows.length > 0 ? Number(rows[0].total_tickets_sold ?? 0) : 0

    const tickets = rows.map((r: any) => ({
      ticket_number: r.ticket_number,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      email: r.email ?? null,
      mobile: r.mobile ?? null,
      order_reference: r.order_reference ?? null,
      purchased_at: r.purchased_at ?? null,
    }))

    return NextResponse.json(
      {
        ok: true,
        tickets,
        page,
        pageSize: PAGE_SIZE,
        totalTicketsSold,
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/campaign-tickets] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}
