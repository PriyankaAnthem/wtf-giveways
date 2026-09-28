import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  // Auth: token query param must match CRON_SECRET
  const tokenParam = request.nextUrl.searchParams.get('token')
  const expectedToken = process.env.CRON_SECRET

  if (!expectedToken || tokenParam !== expectedToken) {
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

  try {
    // 1) Fetch latest winners
    const { data: winners, error: winnersErr } = await supabase
      .from('winners')
      .select('id, campaign_id, nickname, prize_title, announced_at')
      .order('announced_at', { ascending: false })
      .limit(50)

    if (winnersErr) {
      return NextResponse.json({ ok: false, error: winnersErr.message }, { status: 500 })
    }

    if (!winners || winners.length === 0) {
      // Delete existing list snapshots and return 0
      await supabase
        .from('winner_snapshots')
        .delete()
        .eq('kind', 'list')

      return NextResponse.json({ ok: true, count: 0 })
    }

    // 2) Fetch campaign info for those campaign IDs
    const campaignIds = [...new Set(winners.map((w) => w.campaign_id).filter(Boolean))]
    const campaignMap = new Map<string, { title: string; slug: string }>()

    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id, title, slug')
        .in('id', campaignIds)

      if (campaigns) {
        for (const c of campaigns) {
          campaignMap.set(String(c.id), { title: c.title || '', slug: c.slug || '' })
        }
      }
    }

    // 3) Delete existing list snapshots
    const { error: delErr } = await supabase
      .from('winner_snapshots')
      .delete()
      .eq('kind', 'list')

    if (delErr) {
      return NextResponse.json({ ok: false, error: `Delete failed: ${delErr.message}` }, { status: 500 })
    }

    // 4) Insert one row per winner
    const generatedAt = new Date().toISOString()

    const rows = winners.map((w) => {
      const campaign = campaignMap.get(String(w.campaign_id))
      return {
        kind: 'list',
        campaign_id: w.campaign_id,
        generated_at: generatedAt,
        payload: {
          nickname: w.nickname || 'Winner',
          name: w.nickname || 'Winner',
          prize_title: w.prize_title || 'Prize',
          campaign_title: campaign?.title || '',
          campaign_slug: campaign?.slug || '',
          announced_at: w.announced_at || generatedAt,
          avatar_url: '/placeholder.svg',
          quote: null,
        },
      }
    })

    const { error: insErr } = await supabase
      .from('winner_snapshots')
      .insert(rows)

    if (insErr) {
      return NextResponse.json({ ok: false, error: `Insert failed: ${insErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, count: rows.length })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
