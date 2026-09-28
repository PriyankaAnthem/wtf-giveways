// Shared types for the WTF admin sales reporting dashboard.
// The payload shape mirrors get_admin_sales_dashboard() in
// scripts/reporting/004-reporting-dashboard-rpc.sql.

export const REPORT_RANGES = [
  'today',
  'yesterday',
  'last_7_days',
  'this_month',
  'previous_month',
  'custom',
] as const

export type ReportRange = (typeof REPORT_RANGES)[number]

export const REPORT_RANGE_LABELS: Record<ReportRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  this_month: 'This month',
  previous_month: 'Previous month',
  custom: 'Custom range',
}

export const CAMPAIGN_SORTS = [
  'gross',
  'external',
  'credit',
  'orders',
  'tickets',
  'title',
] as const

export type CampaignSort = (typeof CAMPAIGN_SORTS)[number]

export interface ReportFilters {
  range: ReportRange
  from: string | null // yyyy-mm-dd (custom only)
  to: string | null // yyyy-mm-dd (custom only)
  campaign: string | null // campaign uuid
  provider: string | null
  sort: CampaignSort
  limit: number
  offset: number
}

export interface KpiTotals {
  gross_pence: number
  external_pence: number
  credit_pence: number
  confirmed_orders: number
  tickets_sold: number
  aov_pence: number
}

export interface ChartPoint {
  t: string
  gross_pence: number
  external_pence: number
  credit_pence: number
  orders: number
  tickets: number
}

export interface CampaignPerformanceRow {
  campaign_id: string
  title: string
  status: string
  gross_pence: number
  external_pence: number
  credit_pence: number
  confirmed_orders: number
  tickets_sold: number
  aov_pence: number
  max_tickets_total: number | null
  pct_sold: number | null
  created_at: string | null
}

export interface DashboardPayload {
  period: {
    range: ReportRange
    label: string
    start: string
    end: string
    campaign: string | null
    provider: string | null
  }
  comparison: { label: string; start: string; end: string }
  totals: KpiTotals
  previous: KpiTotals
  changes: {
    gross_pct: number | null
    external_pct: number | null
    credit_pct: number | null
    orders_pct: number | null
    tickets_pct: number | null
  }
  chart: { unit: string; points: ChartPoint[] }
  campaigns: CampaignPerformanceRow[]
  campaigns_total: number
  available: {
    campaigns: { id: string; title: string }[]
    providers: string[]
  }
  meta: {
    last_refresh_at: string | null
    reconciliation: {
      reconciled_at?: string
      balanced?: boolean
      diff_gross?: number
      diff_external?: number
      diff_credit?: number
      diff_orders?: number
      diff_tickets?: number
    } | null
    generated_at: string
  }
}
