import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchDashboard } from '@/lib/admin/reporting/queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** Escape a CSV field per RFC 4180 (quote if it contains comma/quote/newline). */
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Pence -> plain decimal string for spreadsheets, e.g. 12345 -> "123.45". */
function penceToDecimal(pence: number | null | undefined): string {
  const n = typeof pence === 'number' && Number.isFinite(pence) ? pence : 0
  return (n / 100).toFixed(2)
}

/**
 * Admin-only CSV export of the campaign-level finance breakdown for the
 * selected period. GBP figures are split into gross / external / credit so the
 * export can never be mistaken for a single blended "revenue" number.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchDashboard(role, request.nextUrl.searchParams)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status, headers: NO_STORE })
  }

  const { data, filters } = result
  const campaigns = data.campaigns ?? []

  const header = [
    'campaign_title',
    'status',
    'gross_ticket_sales_gbp',
    'external_payment_revenue_gbp',
    'wtf_credit_redeemed_gbp',
    'confirmed_orders',
    'tickets_sold',
    'avg_order_value_gbp',
    'pct_sold',
  ]

  const lines: string[] = [header.join(',')]

  for (const c of campaigns) {
    lines.push(
      [
        csvField(c.title),
        csvField(c.status),
        penceToDecimal(c.gross_pence),
        penceToDecimal(c.external_pence),
        penceToDecimal(c.credit_pence),
        csvField(c.confirmed_orders),
        csvField(c.tickets_sold),
        penceToDecimal(c.aov_pence),
        csvField(c.pct_sold ?? ''),
      ].join(','),
    )
  }

  // Trailing TOTAL row from the period totals so the export reconciles on its own.
  const t = data.totals
  lines.push(
    [
      csvField('TOTAL'),
      '',
      penceToDecimal(t.gross_pence),
      penceToDecimal(t.external_pence),
      penceToDecimal(t.credit_pence),
      csvField(t.confirmed_orders),
      csvField(t.tickets_sold),
      penceToDecimal(t.aov_pence),
      '',
    ].join(','),
  )

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n' // BOM so Excel reads UTF-8
  const label = filters.range === 'custom' ? `${filters.from}_to_${filters.to}` : filters.range
  const filename = `wtf-reporting-${label}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
