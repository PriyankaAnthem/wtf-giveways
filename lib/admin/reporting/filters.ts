import {
  CAMPAIGN_SORTS,
  REPORT_RANGES,
  type CampaignSort,
  type ReportFilters,
  type ReportRange,
} from './types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Providers are short lowercase identifiers (sumup, acquired, paypal, wallet...).
const PROVIDER_RE = /^[a-z0-9_-]{1,32}$/i

export const MAX_CUSTOM_RANGE_DAYS = 366

export class ReportFilterError extends Error {}

function parseDateOnly(value: string): number {
  // yyyy-mm-dd -> ms at UTC midnight (only used for span validation).
  const [y, m, d] = value.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * Validates + normalizes untrusted query params into ReportFilters.
 * Throws ReportFilterError with a safe, user-facing message on bad input.
 */
export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const rawRange = (params.get('range') ?? 'today').toLowerCase()
  if (!REPORT_RANGES.includes(rawRange as ReportRange)) {
    throw new ReportFilterError('Invalid range')
  }
  const range = rawRange as ReportRange

  let from: string | null = null
  let to: string | null = null

  if (range === 'custom') {
    from = params.get('from')
    to = params.get('to')
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new ReportFilterError('Custom range requires valid from/to dates')
    }
    const fromMs = parseDateOnly(from)
    const toMs = parseDateOnly(to)
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new ReportFilterError('Invalid custom dates')
    }
    if (toMs < fromMs) {
      throw new ReportFilterError('End date must be on or after start date')
    }
    const spanDays = (toMs - fromMs) / 86_400_000
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
      throw new ReportFilterError(
        `Custom range too large (max ${MAX_CUSTOM_RANGE_DAYS} days)`,
      )
    }
  }

  const campaign = params.get('campaign')
  if (campaign && !UUID_RE.test(campaign)) {
    throw new ReportFilterError('Invalid campaign filter')
  }

  const provider = params.get('provider')
  if (provider && !PROVIDER_RE.test(provider)) {
    throw new ReportFilterError('Invalid provider filter')
  }

  const rawSort = (params.get('sort') ?? 'gross').toLowerCase()
  const sort: CampaignSort = CAMPAIGN_SORTS.includes(rawSort as CampaignSort)
    ? (rawSort as CampaignSort)
    : 'gross'

  const limit = clampInt(params.get('limit'), 100, 1, 500)
  const offset = clampInt(params.get('offset'), 0, 0, 100_000)

  return {
    range,
    from,
    to,
    campaign: campaign || null,
    provider: provider || null,
    sort,
    limit,
    offset,
  }
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** RPC argument object for supabase.rpc('get_admin_sales_dashboard', ...). */
export function toRpcArgs(filters: ReportFilters) {
  return {
    p_range: filters.range,
    p_from: filters.from,
    p_to: filters.to,
    p_campaign: filters.campaign,
    p_provider: filters.provider,
    p_campaign_sort: filters.sort,
    p_campaign_limit: filters.limit,
    p_campaign_offset: filters.offset,
  }
}
