import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { loadCampaignAwardCounts } from '@/lib/server/giveaway-snapshot-awards'
import { loadCampaignVideoMap, videoFieldsFor } from '@/lib/media/campaign-video'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function handleJobProcessing(request: NextRequest) {
  // Debug info
  const method = request.method
  const url = request.nextUrl.pathname + request.nextUrl.search
  const userAgent = request.headers.get('user-agent')
  const xVercelCron = request.headers.get('x-vercel-cron')
  const xVercelCronJob = request.headers.get('x-vercel-cron-job')
  const hasAuthorization = Boolean(request.headers.get('authorization'))

  console.log(`[jobs/run] method=${method} url=${url} ua=${userAgent} x-vercel-cron=${xVercelCron} x-vercel-cron-job=${xVercelCronJob} hasAuth=${hasAuthorization}`)

  // 1. Verify authorization
  const authHeader = request.headers.get('authorization')
  const tokenParam = request.nextUrl.searchParams.get('token')
  const expectedToken = process.env.CRON_SECRET

  // A) Manual trigger: valid Bearer token OR valid query param token
  const isManualTrigger = !!(expectedToken && (authHeader === `Bearer ${expectedToken}` || tokenParam === expectedToken))

  // B) Vercel cron trigger: accept if ANY of these is true
  const isVercelCron =
    request.headers.get('x-vercel-cron') === '1' ||
    request.headers.has('x-vercel-cron-job') ||
    (request.headers.get('user-agent') ?? '').includes('vercel-cron')

  if (!isManualTrigger && !isVercelCron) {
    return NextResponse.json({
      error: 'Unauthorized',
      debug: { method, url, ua: userAgent, xVercelCron, xVercelCronJob, hasAuthorization }
    }, { status: 401 })
  }

  // 2. Create Supabase client with SERVICE ROLE key
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  console.log(
    '[jobs/run] supabaseUrlHost=',
    (() => {
      try { return supabaseUrl ? new URL(supabaseUrl).host : 'missing' } catch { return 'invalid' }
    })(),
  )
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  })

  // 2b. Expire due wallet reservations (best-effort, service-role).
  //   Runs on every authenticated invocation of this cron/manual trigger,
  //   BEFORE any job is locked or processed. It calls the confirmed existing
  //   SECURITY DEFINER RPC public.wallet_expire_due_reservations, which
  //   atomically expires only wallet_reservations rows with status='active'
  //   AND expires_at <= now(), releasing their reserved balances. The RPC is
  //   safe to invoke repeatedly (idempotent). Any error here is logged and
  //   swallowed so it can never interfere with normal job processing or the
  //   route's response — the every-minute cadence retries it next run.
  try {
    const { data: expireData, error: expireError } = await supabase.rpc(
      'wallet_expire_due_reservations',
      { p_user_limit: 500 },
    )

    if (expireError) {
      console.error('[jobs/run] wallet_expire_due_reservations error=', expireError.message)
    } else {
      // Treat the RPC payload as untrusted. Accept a numeric counter only when
      // it is a finite, non-negative integer — never coerce strings, nulls,
      // floats, negatives, arrays or objects.
      const toNonNegativeInteger = (value: unknown): number | null =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= 0
          ? value
          : null

      const payload = (expireData ?? null) as Record<string, unknown> | null
      const expiredReservations = toNonNegativeInteger(payload?.expired_reservations)
      const releasedPence = toNonNegativeInteger(payload?.released_pence)

      // Explicitly branch on validity. Both counters must validate; if either
      // is invalid we emit a single bounded error (never the raw payload) and
      // skip the success log. A valid zero-result sweep stays silent so the
      // every-minute cron does not emit noise. Logs never include raw payloads
      // or any per-user/reservation identifiers.
      const countersValid =
        expiredReservations !== null && releasedPence !== null

      if (!countersValid) {
        console.error('[jobs/run] wallet expiry sweep returned invalid counters')
      } else if (expiredReservations > 0 || releasedPence > 0) {
        console.info('[jobs/run] wallet expiry sweep completed', {
          expiredReservations,
          releasedPence,
        })
      }
    }
  } catch (expireErr) {
    console.error(
      '[jobs/run] wallet_expire_due_reservations threw=',
      expireErr instanceof Error ? expireErr.message : String(expireErr),
    )
  }

  try {
    // 3. Lock ONE eligible job
    const nowIso = new Date().toISOString()
    console.log('[jobs/run] nowIso=', nowIso)
    const lockDuration = 60 // seconds
    const lockedUntil = new Date(Date.now() + lockDuration * 1000).toISOString()

    // Find eligible job: first try locked_until IS NULL, then locked_until < now
    const { data: nullLockJobs, error: selectError1 } = await supabase
      .from('jobs')
      .select('id, type, payload, attempts, max_attempts')
      .eq('status', 'queued')
      .lte('run_after', nowIso)
      .is('locked_until', null)
      .order('created_at', { ascending: true })
      .limit(1)

    if (selectError1) {
      console.error('[jobs/run] selectError=', JSON.stringify(selectError1))
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    console.log('[jobs/run] eligible_null_count=', nullLockJobs?.length ?? 0)

    let eligibleJobs = nullLockJobs

    if (!eligibleJobs || eligibleJobs.length === 0) {
      const { data: expiredLockJobs, error: selectError2 } = await supabase
        .from('jobs')
        .select('id, type, payload, attempts, max_attempts')
        .eq('status', 'queued')
        .lte('run_after', nowIso)
        .lt('locked_until', nowIso)
        .order('created_at', { ascending: true })
        .limit(1)

      if (selectError2) {
        console.error('[jobs/run] selectError=', JSON.stringify(selectError2))
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }

      console.log('[jobs/run] eligible_lt_count=', expiredLockJobs?.length ?? 0)

      eligibleJobs = expiredLockJobs
    }

    if (!eligibleJobs || eligibleJobs.length === 0) {
      return new NextResponse(null, { status: 204 })
    }

    const job = eligibleJobs[0]
    console.log('[jobs/run] picked_job=', job.id)

    // Lock the job: first try with locked_until IS NULL, then locked_until < now
    const lockPayload = {
      locked_at: nowIso,
      locked_until: lockedUntil,
      locked_by: 'api/jobs/run',
      status: 'processing',
      updated_at: nowIso
    }

    const { data: lockedByNull, error: lockError1 } = await supabase
      .from('jobs')
      .update(lockPayload)
      .eq('id', job.id)
      .eq('status', 'queued')
      .is('locked_until', null)
      .select()
      .single()

    let lockedJob = lockedByNull

    if (lockError1 || !lockedByNull) {
      if (lockError1) console.error('[jobs/run] lockError=', JSON.stringify(lockError1))
      const { data: lockedByExpired, error: lockError2 } = await supabase
        .from('jobs')
        .update(lockPayload)
        .eq('id', job.id)
        .eq('status', 'queued')
        .lt('locked_until', nowIso)
        .select()
        .single()

      if (lockError2 || !lockedByExpired) {
        if (lockError2) console.error('[jobs/run] lockError=', JSON.stringify(lockError2))
        // Job was locked by another process
        return new NextResponse(null, { status: 204 })
      }

      lockedJob = lockedByExpired
    }

    // 4. Process the job
    try {
      if (job.type === 'REFRESH_SNAPSHOTS') {
        await processRefreshSnapshots(supabase, job.payload)
      } else {
        throw new Error(`Unknown job type: ${job.type}`)
      }

      // 5. Mark job as succeeded
      await supabase
        .from('jobs')
        .update({
          status: 'succeeded',
          updated_at: new Date().toISOString(),
          locked_until: null,
          last_error: null
        })
        .eq('id', job.id)

      return NextResponse.json({
        ok: true,
        processed: job.type,
        jobId: job.id
      })

    } catch (processingError) {
      // Handle job failure
      const errorMessage = processingError instanceof Error 
        ? processingError.message.substring(0, 1000)
        : 'Unknown error'

      const newAttempts = job.attempts + 1
      const isFailed = newAttempts >= job.max_attempts

      await supabase
        .from('jobs')
        .update({
          attempts: newAttempts,
          last_error: errorMessage,
          status: isFailed ? 'failed' : 'queued',
          run_after: isFailed ? null : new Date(Date.now() + 30000).toISOString(),
          locked_until: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      if (isFailed) {
        console.error(`[v0] Job ${job.id} failed after ${newAttempts} attempts:`, errorMessage)
      }

      return NextResponse.json({
        ok: true,
        processed: job.type,
        jobId: job.id,
        failed: isFailed
      })
    }

  } catch (error) {
    console.error('[v0] Unexpected error in job processing:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleJobProcessing(request)
}

export async function POST(request: NextRequest) {
  return handleJobProcessing(request)
}

async function processRefreshSnapshots(
  supabase: ReturnType<typeof createClient>,
  payload: any
) {
  console.log('[snapshots] start payload=', JSON.stringify(payload))
  const campaignId = payload?.giveawayId || payload?.campaignId

  // Build query from campaigns table
  let query = supabase
    .from('campaigns')
    .select('id, slug, title, summary, description, status, start_at, end_at, main_prize_title, main_prize_description, hero_image_url, ticket_price_pence, max_tickets_total, max_tickets_per_user, presentation_type')

  if (campaignId) {
    query = query.eq('id', campaignId)
  }

  const { data: campaigns, error: fetchError } = await query

  if (fetchError) {
    throw new Error(`Failed to fetch campaigns: ${fetchError.message}`)
  }

  console.log('[snapshots] campaigns fetched_count=', campaigns?.length ?? 0)
  console.log('[snapshots] campaigns fetched_ids=', (campaigns ?? []).map(c => c.id))

  if (!campaigns || campaigns.length === 0) {
    console.log('[snapshots] No campaigns to refresh')
    return
  }

  // Optional promo video (Video Phase 1). ONE batched, tolerant read for every
  // campaign in this refresh (no N+1). Empty map => poster-only when the
  // additive migration has not been applied yet. (`any` cast mirrors the
  // pre-existing loose typing of `campaigns` in this handler.)
  const videoMap = await loadCampaignVideoMap(
    supabase,
    (campaigns ?? []).map((c: any) => c.id),
  )

  // Process each campaign
  for (const campaign of campaigns) {
    const video = videoFieldsFor(videoMap, (campaign as any).id)
    // Fetch instant win prizes for this campaign
    const { data: prizes, error: prizesError } = await supabase
      .from('instant_win_prizes')
      .select('id, prize_title, image_url, quantity, created_at')
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: true })

    if (prizesError) {
      // Fail closed: throwing skips the snapshot write for this campaign and
      // surfaces the error to the job runner rather than persisting partial data.
      throw new Error(
        `Failed to load instant-win prizes for campaign ${campaign.id}: ${prizesError.message}`,
      )
    }

    // Count ALL awards per prize_id via the shared paginated helper (throws on
    // any Supabase error, so a truncated/failed read never becomes zero awards).
    const { awardCountByPrize, totalAwards, pageCount, prizeIdCount } =
      await loadCampaignAwardCounts(supabase, campaign.id)

    console.log(
      '[snapshots] awards loaded',
      'campaignId=', campaign.id,
      'totalAwards=', totalAwards,
      'pages=', pageCount,
      'prizeIds=', prizeIdCount,
    )

    const instantWins = (prizes ?? []).map((p: any) => {
      const quantity = p.quantity ?? 1
      const awardedCount = awardCountByPrize[p.id] ?? 0
      const remainingCount = Math.max(quantity - awardedCount, 0)
      return {
        id: p.id,
        title: p.prize_title,
        image_url: p.image_url ?? null,
        quantity,
        awarded_count: awardedCount,
        remaining_count: remainingCount,
        is_won: remainingCount === 0,
      }
    })

    console.log('[snapshots] instant_wins_count', campaign.id, instantWins.length)

    // Fetch ticket counter for this campaign
    const { data: counterRow } = await supabase
      .from('giveaway_ticket_counters')
      .select('next_ticket')
      .eq('giveaway_id', campaign.id)
      .maybeSingle()

    const nextTicket = counterRow?.next_ticket ?? 1
    const ticketsSold = Math.max(nextTicket - 1, 0)

    const detailPayload = {
      id: campaign.id,
      slug: campaign.slug,
      title: campaign.title,
      prize_title: campaign.main_prize_title,
      prize_description: campaign.main_prize_description ?? null,
      description: campaign.description ?? null,
      prize_value_text: null,
      hero_image_url: campaign.hero_image_url,
      images: null,
      variant: 'raffle',
      status: campaign.status,
      starts_at: campaign.start_at,
      ends_at: campaign.end_at,
      currency: 'GBP',
      base_ticket_price_pence: campaign.ticket_price_pence,
      bundles: null,
      hard_cap_total_tickets: campaign.max_tickets_total,
      instant_wins: instantWins,
      tickets_sold: ticketsSold,
      next_ticket: nextTicket,
      // Optional promo video — the detail page reads this for tap-to-play.
      promo_video_url: video.promo_video_url,
      promo_video_duration_s: video.promo_video_duration_s,
    }

    console.log('[jobs/run/processRefreshSnapshots] campaignId=', campaign.id, 'slug=', campaign.slug, 'instant_wins=', Array.isArray(detailPayload.instant_wins) ? detailPayload.instant_wins.length : 'MISSING_KEY')

    // Delete existing snapshots for this campaign (both list and detail)
    await supabase
      .from('giveaway_snapshots')
      .delete()
      .eq('giveaway_id', campaign.id)
      .in('kind', ['list', 'detail'])

    const generatedAt = new Date().toISOString()

    // Insert list snapshot (minimal payload for /giveaways listing)
    const listPayload = {
      id: campaign.id,
      slug: campaign.slug,
      title: campaign.title,
      prize_title: campaign.main_prize_title,
      prize_value_text: null,
      hero_image_url: campaign.hero_image_url,
      ends_at: campaign.end_at,
      base_ticket_price_pence: campaign.ticket_price_pence,
      status: campaign.status,
      tickets_sold: ticketsSold,
      next_ticket: nextTicket,
      hard_cap_total_tickets: campaign.max_tickets_total,
      presentation_type: campaign.presentation_type ?? null,
      // Optional promo video (poster-first Featured Hero enhancement).
      promo_video_url: video.promo_video_url,
      promo_video_duration_s: video.promo_video_duration_s,
    }

    const { error: listError } = await supabase
      .from('giveaway_snapshots')
      .insert({
        giveaway_id: campaign.id,
        kind: 'list',
        generated_at: generatedAt,
        payload: listPayload
      })

    if (listError) {
      throw new Error(`Failed to insert list snapshot for campaign ${campaign.id}: ${listError.message}`)
    }

    // Insert detail snapshot (full payload for /giveaways/[slug])
    const { error: detailError } = await supabase
      .from('giveaway_snapshots')
      .insert({
        giveaway_id: campaign.id,
        kind: 'detail',
        generated_at: generatedAt,
        payload: detailPayload
      })

    if (detailError) {
      throw new Error(`Failed to insert detail snapshot for campaign ${campaign.id}: ${detailError.message}`)
    }

    console.log('[snapshots] wrote_snapshot campaign=', campaign.id)
  }

  console.log(`[snapshots] Refreshed ${campaigns.length} campaign snapshot(s)`)
}
