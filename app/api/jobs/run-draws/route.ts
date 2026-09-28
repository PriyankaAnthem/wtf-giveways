import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeEndDrawMode } from '@/lib/types/campaign'
import { refreshWinnerDownstream } from '@/lib/server/winner-draw-refresh'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BATCH_SIZE = 50
const MAX_LOOPS = 100 // Hard guard to prevent infinite loops

export async function GET(request: NextRequest) {
  // Auth: Accept manual trigger (Bearer token or query param) OR Vercel cron headers
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const summary = {
    ok: true,
    processed: 0,
    ended: 0,
    extended: 0,
    // Newly drawn main winners (automatic mode only).
    drawn: 0,
    // Campaigns closed in manual mode, now awaiting an admin draw.
    awaitingManualDraw: 0,
    batches: 0,
    errors: [] as string[],
  }

  try {
    let loopCount = 0

    // Queue-drain loop: always fetch FIRST batch, process, repeat until empty
    while (loopCount < MAX_LOOPS) {
      loopCount++

      // 1) Fetch FIRST batch of ONLY eligible campaigns:
      //    - status = 'sold_out' (always eligible)
      //    - OR end_at <= now (past due)
      const nowIso = new Date().toISOString()
      const { data: campaigns, error: fetchErr } = await supabase
        .from('campaigns')
        .select('id, title, slug, status, end_at, main_prize_title, max_tickets_total, end_draw_mode')
        .or(`status.eq.sold_out,end_at.lte.${nowIso}`)
        .not('status', 'eq', 'ended')
        .order('end_at', { ascending: true })
        .limit(BATCH_SIZE)

      if (fetchErr) {
        return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
      }

      // Exit when no more eligible campaigns
      if (!campaigns || campaigns.length === 0) {
        break
      }

      summary.batches++

      let processedAnyInBatch = false

      // 2) Process each campaign in this batch
      for (const campaign of campaigns) {
        summary.processed++

        try {
          // a) Compute tickets_sold
          const { data: sumData, error: sumErr } = await supabase
            .from('entries')
            .select('qty')
            .eq('campaign_id', campaign.id)

          if (sumErr) {
            summary.errors.push(`${campaign.id}: entries query failed - ${sumErr.message}`)
            continue
          }

          const ticketsSold = (sumData ?? []).reduce((acc, row) => acc + (row.qty || 0), 0)

          // b) Hard-cap: if max_tickets_total reached and not yet sold_out, mark sold_out
          if (
            campaign.max_tickets_total != null &&
            ticketsSold >= campaign.max_tickets_total &&
            campaign.status !== 'sold_out'
          ) {
            await supabase
              .from('campaigns')
              .update({ status: 'sold_out' })
              .eq('id', campaign.id)
            campaign.status = 'sold_out'
          }

          // c) Eligibility: only draw if sold_out or past end_at
          const isPastEnd = new Date(campaign.end_at) <= new Date()
          const isEligibleToDraw = campaign.status === 'sold_out' || isPastEnd

          if (!isEligibleToDraw) {
            // Not eligible yet - will remain in queue, skip for now
            continue
          }

          // d) If zero sales, extend by 7 days (removes from eligible set)
          if (ticketsSold === 0) {
            const currentEnd = new Date(campaign.end_at)
            const newEnd = new Date(currentEnd.getTime() + 7 * 24 * 60 * 60 * 1000)

            const { error: extErr } = await supabase
              .from('campaigns')
              .update({ end_at: newEnd.toISOString() })
              .eq('id', campaign.id)

            if (extErr) {
              summary.errors.push(`${campaign.id}: extend failed - ${extErr.message}`)
            } else {
              summary.extended++
              processedAnyInBatch = true
            }
            continue
          }

          // e) MANUAL mode: close the competition WITHOUT drawing.
          //    The campaign becomes "awaiting manual draw" (status = 'ended',
          //    end_draw_mode = 'manual', no placed = 1 winner) and an admin
          //    draws it later. Instant wins are unaffected.
          if (normalizeEndDrawMode(campaign.end_draw_mode) === 'manual') {
            const { error: manualEndErr } = await supabase
              .from('campaigns')
              .update({ status: 'ended' })
              .eq('id', campaign.id)

            if (manualEndErr) {
              summary.errors.push(`${campaign.id}: manual close failed - ${manualEndErr.message}`)
              continue
            }

            summary.ended++
            summary.awaitingManualDraw++
            processedAnyInBatch = true

            // Status changed, so refresh the pre-computed snapshots.
            summary.errors.push(
              ...(await refreshWinnerDownstream(request.nextUrl.origin, expectedToken, campaign.id)),
            )
            continue
          }

          // f) AUTOMATIC mode: draw FIRST via the single authoritative
          //    algorithm, and only mark the campaign ended once the draw is
          //    resolved.
          //
          //    Ordering is critical: the eligibility query above excludes
          //    status = 'ended', so a campaign marked ended before a failed
          //    draw would be permanently skipped by every future cron run.
          //    On any draw error we leave the status untouched so the next
          //    invocation retries.
          const { data: drawData, error: drawErr } = await supabase.rpc('draw_campaign_winner', {
            p_campaign_id: campaign.id,
          })

          if (drawErr) {
            summary.errors.push(`${campaign.id}: draw rpc failed - ${drawErr.message}`)
            continue
          }

          const draw = (drawData ?? {}) as {
            ok?: boolean
            already_drawn?: boolean
            error?: string
            user_id?: string
            winning_ticket?: number
          }

          if (!draw.ok) {
            summary.errors.push(`${campaign.id}: draw failed - ${draw.error ?? 'unknown'}`)
            continue
          }

          // Both a newly created winner and already_drawn = true are a
          // successfully RESOLVED draw state.
          if (!draw.already_drawn) summary.drawn++

          // g) Draw resolved: set campaign to ended
          const { error: endErr } = await supabase
            .from('campaigns')
            .update({ status: 'ended' })
            .eq('id', campaign.id)

          if (endErr) {
            summary.errors.push(`${campaign.id}: status update failed - ${endErr.message}`)
          }

          summary.ended++
          processedAnyInBatch = true

          // h) Trigger snapshot refreshes (best-effort, collect errors)
          summary.errors.push(
            ...(await refreshWinnerDownstream(request.nextUrl.origin, expectedToken, campaign.id)),
          )

        } catch (err: any) {
          summary.errors.push(`${campaign.id}: unexpected - ${err?.message}`)
        }
      }

      // Safety: if we processed a full batch but none were actually handled (all ineligible),
      // we'd loop forever. Break if nothing changed this batch.
      if (!processedAnyInBatch) {
        break
      }
    }

    // Add loop count to summary for monitoring
    if (loopCount >= MAX_LOOPS) {
      summary.errors.push(`Hit MAX_LOOPS guard (${MAX_LOOPS}) - some campaigns may remain`)
    }

    return NextResponse.json({ ...summary, loops: loopCount })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
