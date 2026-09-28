/**
 * Stage 2 Marketing — PURE presentational sections.
 *
 * None of these components use hooks, effects, fetches or client-only APIs, so
 * they render deterministically under renderToStaticMarkup in the node test
 * environment. All data arrives via props from the client dashboard. They can
 * ONLY display aggregate counts — there is no send control anywhere.
 */
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import {
  AUDIENCE_CATALOGUE,
  formatCount,
  formatCreditPence,
  isCreditAudience,
  type AudienceCount,
  type MarketingAudienceHealth,
  type MarketingAudiences,
  type MarketingProfileFreshness,
} from '@/lib/admin/marketing/audiences'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'Never'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(new Date(t))
}

/** Matched (muted) + Eligible (dominant) pair used across every audience card. */
function MatchedEligible({ audience }: { audience: AudienceCount }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Matched</span>
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {formatCount(audience.matchedCount)}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-[11px] uppercase tracking-wide text-primary/80">Eligible</span>
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {formatCount(audience.eligibleCount)}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1) Profile status
// ---------------------------------------------------------------------------

export function ProfileStatus({ freshness }: { freshness: MarketingProfileFreshness }) {
  const backfillIncomplete = !freshness.backfillComplete
  // Precedence: an in-progress backfill is the most important thing to show;
  // otherwise a stale profile; otherwise up to date.
  const tone: 'warn' | 'ok' = backfillIncomplete || freshness.stale ? 'warn' : 'ok'

  const Icon = backfillIncomplete ? Clock : freshness.stale ? AlertTriangle : CheckCircle2
  const heading = backfillIncomplete
    ? 'Customer profile is still building'
    : freshness.stale
      ? 'Stale profile'
      : 'Customer profile is up to date'
  const detail = backfillIncomplete
    ? 'Audience counts are partial until the initial backfill completes.'
    : freshness.stale
      ? 'Customer profile has not refreshed recently. Counts may be out of date.'
      : 'Counts reflect the most recent refresh.'

  return (
    <section
      aria-label="Customer profile status"
      className={
        tone === 'warn'
          ? 'rounded-xl border border-amber-500/40 bg-amber-500/5 p-4'
          : 'rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4'
      }
    >
      <div className="flex items-start gap-3">
        <Icon
          className={
            tone === 'warn'
              ? 'mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400'
              : 'mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400'
          }
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{heading}</p>
            <p className="text-xs text-muted-foreground text-pretty">{detail}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Current profile count</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {formatCount(freshness.profileCount)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Last successful refresh</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {formatDateTime(freshness.lastSuccessAt)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Last processed batch</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {formatCount(freshness.lastProcessedUsers)}
              </dd>
            </div>
          </dl>
          {backfillIncomplete ? (
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Counts are partial.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 2) Audience health KPIs
// ---------------------------------------------------------------------------

function HealthStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-balance">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-foreground">{formatCount(value)}</span>
    </div>
  )
}

export function AudienceHealth({ health }: { health: MarketingAudienceHealth }) {
  return (
    <section aria-label="Audience health" className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Audience health</h2>
        <p className="text-xs text-muted-foreground">
          Operational counts across the whole customer profile. These are not legal conclusions.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <HealthStat label="Total profiles" value={health.totalProfiles} />
        <HealthStat label="Currently eligible" value={health.currentlyEligible} />
        <HealthStat label="Marketing enabled" value={health.marketingEnabled} />
        <HealthStat label="Actively suppressed" value={health.activelySuppressed} />
        <HealthStat label="Customers with orders" value={health.customersWithOrders} />
        <HealthStat label="Customers without orders" value={health.customersWithoutOrders} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <span>Email unconfirmed</span>
          <span className="font-medium tabular-nums text-foreground">
            {formatCount(health.emailUnconfirmed)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <span>Inactive accounts</span>
          <span className="font-medium tabular-nums text-foreground">
            {formatCount(health.inactiveAccounts)}
          </span>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 3) Recommended opportunities
// ---------------------------------------------------------------------------

function OpportunityCard({
  title,
  copy,
  audience,
  extra,
}: {
  title: string
  copy: string
  audience: AudienceCount
  extra?: { label: string; value: string }
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground text-pretty">{copy}</p>
      </div>
      <MatchedEligible audience={audience} />
      {extra ? (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
          <span className="text-muted-foreground">{extra.label}</span>
          <span className="font-semibold tabular-nums text-foreground">{extra.value}</span>
        </div>
      ) : null}
      <span className="text-[11px] font-medium text-muted-foreground">
        Campaign sending arrives in Stage 3
      </span>
    </div>
  )
}

export function OpportunityCards({ audiences }: { audiences: MarketingAudiences }) {
  const credit = audiences.customersWithCredit
  return (
    <section aria-label="Recommended opportunities" className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Recommended opportunities</h2>
        <p className="text-xs text-muted-foreground">
          The highest-value segments to act on first. Eligible is the future sendable count.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OpportunityCard
          title="Recent buyers"
          copy="Recently active customers who have not purchased today."
          audience={audiences.recentBuyersNotToday}
        />
        <OpportunityCard
          title="One-time buyers"
          copy="Customers who bought once but have not returned."
          audience={audiences.oneTimeBuyers}
        />
        <OpportunityCard
          title="Lapsed customers"
          copy="Previous customers with no purchase for at least 14 days."
          audience={audiences.lapsed14Days}
        />
        <OpportunityCard
          title="WTF Credit waiting"
          copy="Customers with WTF Credit available to spend."
          audience={credit}
          extra={{
            label: 'Eligible credit available',
            value: formatCreditPence(credit.eligibleAvailableCreditPence),
          }}
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 4) Full audience catalogue
// ---------------------------------------------------------------------------

function CatalogueCard({
  title,
  description,
  audience,
}: {
  title: string
  description: string
  audience: AudienceCount
}) {
  const credit = isCreditAudience(audience) ? audience : null
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground text-pretty">{description}</p>
      </div>
      <MatchedEligible audience={audience} />
      {credit ? (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
          <span className="text-muted-foreground">Eligible credit</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatCreditPence(credit.eligibleAvailableCreditPence)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function AudienceCatalogue({ audiences }: { audiences: MarketingAudiences }) {
  return (
    <section aria-label="Full audience catalogue" className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Full audience catalogue</h2>
        <p className="text-xs text-muted-foreground">
          Every audience with its matched and eligible counts. Lapsed segments intentionally overlap.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AUDIENCE_CATALOGUE.map((meta) => (
          <CatalogueCard
            key={meta.key}
            title={meta.title}
            description={meta.description}
            audience={audiences[meta.field]}
          />
        ))}
      </div>
    </section>
  )
}
