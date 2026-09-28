import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

// Canonical UUID matcher — the source id must be a UUID before any
// service-role read is performed with it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

// Prefix marking a slug as a temporary placeholder created by duplication. The
// form's publish validation refuses to publish while a slug still starts with
// this, so a copy can never go live on an auto-generated URL.
const TEMP_SLUG_PREFIX = 'draft-copy-'

/**
 * Lowercase, URL-safe slug fragment: letters/digits/hyphens only, collapsed
 * hyphens, no leading/trailing hyphen. Never trusts browser input — the base is
 * derived server-side from the source slug/title.
 */
function sanitiseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/** 8-char, cryptographically-derived, URL-safe uniqueness suffix. */
function shortSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Build a unique temporary draft slug: `draft-copy-<base>-<suffix>`.
 * The base is capped so the whole slug stays a sensible length (<= 60 chars).
 */
function buildTempSlug(sourceSlug: string | null, title: string | null): string {
  const base = sanitiseSlug(sourceSlug || title || 'campaign') || 'campaign'
  // Reserve room for `draft-copy-` (11) + `-` + 8-char suffix within ~60 chars.
  const cappedBase = base.slice(0, 40).replace(/-+$/g, '') || 'campaign'
  return `${TEMP_SLUG_PREFIX}${cappedBase}-${shortSuffix()}`
}

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

// Columns copied from the source campaign. This is an EXPLICIT allow-list — we
// never `select('*')` and never spread the source row. Transactional / identity
// / status / timestamp columns are deliberately excluded.
const SOURCE_COLUMNS =
  'title, slug, summary, description, main_prize_title, main_prize_description, hero_image_url, ticket_price_pence, was_price_pence, max_tickets_total, max_tickets_per_user, presentation_type, reveal_type, is_free_entry, free_entry_limit_per_user, bundles'

export async function POST(request: Request) {
  const supabase = await createClient()
  // 1) Authorise BEFORE creating any service-role client.
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const sourceId = body.sourceId
  const copyBundles = body.copyBundles === true

  // 2) Validate the source id as a UUID.
  if (!isUuid(sourceId)) {
    return NextResponse.json({ ok: false, error: 'invalid_source_id' }, { status: 400 })
  }
  const src = sourceId.trim()

  const svc = getServiceSupabase()
  if (!svc) {
    return NextResponse.json({ ok: false, error: 'server_misconfigured' }, { status: 500 })
  }

  // 3) Load the source campaign (allow-listed columns only).
  const { data: source, error: sourceError } = await svc
    .from('campaigns')
    .select(SOURCE_COLUMNS)
    .eq('id', src)
    .single()

  if (sourceError || !source) {
    return NextResponse.json({ ok: false, error: 'source_not_found' }, { status: 404 })
  }

  // 4) Build the new draft row through an explicit allow-list. The server
  //    decides ALL reset values — none of them come from the browser.
  const now = new Date()
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const newRow: Record<string, any> = {
    // reset / forced values (server-controlled)
    status: 'draft',
    title: `${source.title ?? 'Untitled'} (Copy)`,
    // Server-generated UNIQUE temporary placeholder slug. Never blank (blank
    // collides with the existing empty-slug row) and never the source slug
    // verbatim. The `draft-copy-` prefix blocks publishing until it's replaced.
    slug: buildTempSlug(source.slug ?? null, source.title ?? null),
    start_at: now.toISOString(),
    end_at: end.toISOString(),
    // copied reusable setup (explicit allow-list)
    summary: source.summary ?? null,
    description: source.description ?? null,
    main_prize_title: source.main_prize_title ?? null,
    main_prize_description: source.main_prize_description ?? null,
    hero_image_url: source.hero_image_url ?? null,
    ticket_price_pence: source.ticket_price_pence ?? 0,
    was_price_pence: source.was_price_pence ?? null,
    max_tickets_total: source.max_tickets_total ?? null,
    max_tickets_per_user: source.max_tickets_per_user ?? null,
    presentation_type: source.presentation_type ?? null,
    reveal_type: source.reveal_type === 'scratch_card' ? 'scratch_card' : 'normal',
    is_free_entry: source.is_free_entry ?? false,
    free_entry_limit_per_user: source.free_entry_limit_per_user ?? 1,
    // bundles only when explicitly requested
    bundles: copyBundles ? (source.bundles ?? null) : null,
  }

  // Postgres unique-violation code. Supabase surfaces it as error.code '23505'.
  const isUniqueViolation = (err: { code?: string | null } | null) => err?.code === '23505'

  // Insert with a single retry on a unique-slug collision (fresh suffix). We do
  // NOT loop indefinitely — one retry, then a safe 409.
  let inserted: { id: string } | null = null
  let insertError: { code?: string | null; message?: string } | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // Regenerate a brand-new unique suffix before retrying.
      newRow.slug = buildTempSlug(source.slug ?? null, source.title ?? null)
    }
    const result = await svc.from('campaigns').insert(newRow).select('id').single()
    if (!result.error && result.data) {
      inserted = result.data
      insertError = null
      break
    }
    insertError = result.error
    // Only a unique violation is worth retrying; anything else fails now.
    if (!isUniqueViolation(result.error)) break
  }

  if (!inserted) {
    // Log the real DB code server-side; never expose it to the browser.
    console.error(
      '[v0][campaign-duplicate] insert failed',
      JSON.stringify({ code: insertError?.code ?? null, message: insertError?.message ?? null }),
    )
    if (isUniqueViolation(insertError)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'A unique draft identifier could not be created. Please try again.',
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { ok: false, error: 'Could not create the draft copy. Please try again.' },
      { status: 500 },
    )
  }

  const newId: string = inserted.id

  // 5) Safe response — new id + summary only. Never returns source rows or raw
  //    Supabase errors. Instant-win prizes are intentionally NOT copied: the DB
  //    trigger would create live slots, so the admin re-adds prizes manually,
  //    guaranteeing the duplicate has zero instant-win slots/positions/awards.
  return NextResponse.json({
    ok: true,
    id: newId,
    bundlesCopied: copyBundles,
    warnings: [
      'This is a temporary draft slug — replace it with the final campaign URL before publishing.',
      'Instant-win prizes were NOT copied — add them manually before publishing.',
      'Review the title, slug, dates, pricing, capacity, artwork and bundles before publishing.',
      'Artwork is shared with the original until you upload a new image.',
    ],
  })
}
