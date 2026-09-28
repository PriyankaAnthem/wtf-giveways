import { requireAdmin } from '@/lib/admin/auth'
import { loadHomepageMerchandising, loadHomepageRails } from '@/lib/admin/homepage-merchandising'
import { HomepageManager } from '@/components/admin/homepage/HomepageManager'
import { HomepageHeroControl } from '@/components/admin/homepage/HomepageHeroControl'
import { HomepageHero } from '@/components/home/HomepageHero'
import {
  loadHomepageHeroConfig,
  loadHomepageHero,
  getHeroLiveAdminState,
} from '@/lib/homepage-hero'

/**
 * Homepage merchandising admin screen.
 *
 * Admin-only (Super Admin). The page is a Server Component: it guards access,
 * performs the SINGLE merchandising read (two parallel queries via the shared
 * loader), and hands the fully-ordered rails + eligible picker source to the
 * client manager. There is no query-per-rail and no client-side initial fetch.
 */
export default async function HomepageMerchandisingPage() {
  await requireAdmin({ roles: ['admin'] })

  const { rails, eligible, railOrder } = await loadHomepageMerchandising()

  // Homepage Main Banner (hero): the saved singleton config, the real hero
  // preview (built from the SAME loader the public page uses, so admin sees
  // exactly what ships), and the admin-facing LIVE state for the saved Balloon
  // Pop. All reads fail soft so the admin page always renders.
  const heroConfig = await loadHomepageHeroConfig()

  // Reuse the already-computed eligible payloads for the preview — no extra
  // list query (loadHomepageRails is memoised within the request).
  const { eligiblePayloads } = await loadHomepageRails()
  const heroPreview = await loadHomepageHero(eligiblePayloads)

  const liveAdmin = heroConfig.heroCampaignId
    ? await getHeroLiveAdminState(heroConfig.heroCampaignId)
    : { isBalloon: false, boardExists: false, takeover: null }

  const heroEligible = eligible.map((item) => ({
    id: item.id,
    title: item.title,
    slug: item.slug,
    category: item.category,
  }))

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Homepage Management</h2>
        <p className="text-sm text-muted-foreground">
          Configure which competitions appear in each homepage rail and the order they show in.
          Changes are staged locally and only persisted when you press{' '}
          <span className="font-medium text-foreground">Save Changes</span> for that rail.
        </p>
      </div>

      <HomepageHeroControl
        eligible={heroEligible}
        initialCampaignId={heroConfig.heroCampaignId}
        initialBadge={heroConfig.heroBadge}
        liveTakeover={liveAdmin.takeover}
        preview={<HomepageHero hero={heroPreview} />}
      />

      <HomepageManager initialRails={rails} eligible={eligible} initialRailOrder={railOrder} />
    </div>
  )
}
