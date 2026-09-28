import { CampaignForm } from "@/components/admin/campaigns/CampaignForm"
import {
  EndDrawPanel,
  type ExistingMainWinner,
} from "@/components/admin/campaigns/EndDrawPanel"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeEndDrawMode, type Campaign } from "@/lib/types/campaign"
import { loadCampaignVideoMap, videoFieldsFor } from "@/lib/media/campaign-video"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const defaultCampaign: Campaign = {
  id: "",
  status: "draft",
  title: "",
  slug: "",
  summary: "",
  description: "",
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  mainPrizeTitle: "",
  mainPrizeDescription: "",
  heroImageUrl: "",
  ticketPricePence: 99,
  maxTicketsTotal: null,
  maxTicketsPerUser: null,
  bundles: null,
  reveal_type: 'normal',
  end_draw_mode: 'automatic',
}

export default async function CampaignFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ duplicated?: string }>
}) {
  const { id } = await params
  const { duplicated } = await searchParams
  const justDuplicated = duplicated === "1"
  const isNew = id === "new"

  await requireAdmin({ roles: ['admin'] })

  if (isNew) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Create Campaign</h2>
          <p className="text-muted-foreground">Set up a new giveaway campaign</p>
        </div>
        <CampaignForm campaign={defaultCampaign} isNew />
      </div>
    )
  }

  if (!UUID_RE.test(id)) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight">Campaign not found</h2>
        <p className="text-muted-foreground">The campaign ID is not valid.</p>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: r, error } = await supabase
    .from('campaigns')
    .select(
      'id, status, title, slug, summary, description, start_at, end_at, main_prize_title, main_prize_description, hero_image_url, ticket_price_pence, was_price_pence, max_tickets_total, max_tickets_per_user, bundles, reveal_type, presentation_type, end_draw_mode'
    )
    .eq('id', id)
    .single()

  if (error || !r) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight">Campaign not found</h2>
        <p className="text-muted-foreground">
          {error ? error.message : 'No campaign with that ID exists.'}
        </p>
      </div>
    )
  }

  const campaign: Campaign = {
    id: String(r.id),
    status: r.status ?? 'draft',
    title: r.title ?? '',
    slug: r.slug ?? '',
    summary: r.summary ?? '',
    description: r.description ?? '',
    startAt: r.start_at ?? '',
    endAt: r.end_at ?? '',
    mainPrizeTitle: r.main_prize_title ?? '',
    mainPrizeDescription: r.main_prize_description ?? '',
    heroImageUrl: r.hero_image_url ?? '',
    ticketPricePence: r.ticket_price_pence ?? 0,
    wasPricePence: r.was_price_pence ?? null,
    maxTicketsTotal: r.max_tickets_total ?? null,
    maxTicketsPerUser: r.max_tickets_per_user ?? null,
    bundles: r.bundles ?? null,
    reveal_type: r.reveal_type === 'scratch_card' ? 'scratch_card' : 'normal',
    presentation_type: r.presentation_type ?? null,
    end_draw_mode: normalizeEndDrawMode(r.end_draw_mode),
  }

  // Optional promo video (Video Phase 1) — tolerant batched read so the edit
  // page keeps working before the 013-campaign-video migration is applied.
  const videoFields = videoFieldsFor(await loadCampaignVideoMap(supabase, [campaign.id]), campaign.id)
  campaign.promoVideoUrl = videoFields.promo_video_url
  campaign.promoVideoDurationS = videoFields.promo_video_duration_s

  // A manual-draw campaign that has closed is "awaiting end draw" until a
  // placed = 1 winner exists. Both lookups below are cheap indexed reads and
  // only run for closed manual campaigns, so nothing is added to the normal
  // edit path (and nothing at all to customer pages).
  const isClosedManual = campaign.end_draw_mode === 'manual' && campaign.status === 'ended'

  let existingWinner: ExistingMainWinner | null = null
  let ticketsIssued = 0

  if (isClosedManual) {
    const [{ data: winnerRow }, { count: ticketCount }] = await Promise.all([
      supabase
        .from('winner_records')
        .select('id, user_id, prize_title, announced_at')
        .eq('giveaway_id', campaign.id)
        .eq('placed', 1)
        .maybeSingle(),
      supabase
        .from('ticket_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id),
    ])

    existingWinner = winnerRow
      ? {
          id: String(winnerRow.id),
          user_id: winnerRow.user_id ?? null,
          prize_title: winnerRow.prize_title ?? null,
          announced_at: winnerRow.announced_at ?? null,
        }
      : null
    ticketsIssued = ticketCount ?? 0
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Edit Campaign</h2>
        <p className="text-muted-foreground">Update campaign details</p>
      </div>
      {isClosedManual ? (
        <EndDrawPanel
          campaignId={campaign.id}
          ticketsIssued={ticketsIssued}
          existingWinner={existingWinner}
        />
      ) : null}
      <CampaignForm campaign={campaign} isNew={false} justDuplicated={justDuplicated} />
    </div>
  )
}
