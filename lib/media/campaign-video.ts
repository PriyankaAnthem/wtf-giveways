import 'server-only'

/**
 * Server-side helpers for propagating the optional campaign promo video into
 * snapshot payloads, TOLERANT of the additive migration (013-campaign-video)
 * not having been applied yet.
 *
 * Why tolerant: the columns `campaigns.promo_video_url` /
 * `campaigns.promo_video_duration_s` are additive. If a snapshot writer or the
 * admin form runs before the migration is applied, selecting/writing those
 * columns would error and break existing (image-only) behaviour. These helpers
 * detect the "column does not exist" signal and degrade to poster-only instead
 * of throwing, so the app behaves EXACTLY as today until the migration lands,
 * and lights up automatically afterwards.
 */

/** Minimal shape of the PostgREST error object we branch on. */
export interface PostgrestLikeError {
  code?: string | null
  message?: string | null
}

/**
 * True when an error means our promo-video columns are not present yet.
 *   - Postgres undefined_column → SQLSTATE 42703
 *   - PostgREST schema-cache miss → code 'PGRST204' with the column named
 */
export function isMissingVideoColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  const mentionsVideoColumn = message.includes('promo_video')
  if (code === '42703' && mentionsVideoColumn) return true
  if (code === 'PGRST204' && mentionsVideoColumn) return true
  // Some drivers only surface the message.
  if (mentionsVideoColumn && message.includes('does not exist')) return true
  if (mentionsVideoColumn && message.includes('schema cache')) return true
  return false
}

export interface CampaignVideoFields {
  promo_video_url: string | null
  promo_video_duration_s: number | null
}

const EMPTY_VIDEO: CampaignVideoFields = {
  promo_video_url: null,
  promo_video_duration_s: null,
}

/** Normalise a stored URL: trimmed non-empty string, else null. */
export function normaliseVideoUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Normalise a stored duration: positive integer within the 15s cap, else null. */
export function normaliseVideoDurationS(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(15, Math.round(n))
}

/**
 * Load promo-video fields for a set of campaigns in ONE batched query (no N+1).
 * Returns a Map keyed by campaign id. On a missing-column error (migration not
 * applied) or any other read error, returns an EMPTY map so callers fall back
 * to poster-only — this is snapshot-WRITE-path work, never the render path.
 *
 * `supabase` is intentionally `any`: this is called with several differently
 * parameterised Supabase client instances (service-role and RLS), and the only
 * surface used is `.from('campaigns').select(...).in('id', ids)`.
 */
export async function loadCampaignVideoMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  campaignIds: readonly string[],
): Promise<Map<string, CampaignVideoFields>> {
  const map = new Map<string, CampaignVideoFields>()
  const ids = Array.from(new Set(campaignIds.map((id) => String(id)).filter(Boolean)))
  if (ids.length === 0) return map

  const { data, error } = await supabase
    .from('campaigns')
    .select('id, promo_video_url, promo_video_duration_s')
    .in('id', ids)

  if (error) {
    if (!isMissingVideoColumnError(error)) {
      console.error('[campaign-video] read error (falling back to poster-only):', error.message)
    }
    return map
  }

  for (const row of data ?? []) {
    map.set(String(row.id), {
      promo_video_url: normaliseVideoUrl(row.promo_video_url),
      promo_video_duration_s: normaliseVideoDurationS(row.promo_video_duration_s),
    })
  }
  return map
}

/** Video fields for one campaign id from a preloaded map (never throws). */
export function videoFieldsFor(
  map: Map<string, CampaignVideoFields>,
  campaignId: string,
): CampaignVideoFields {
  return map.get(String(campaignId)) ?? EMPTY_VIDEO
}
