'use client'

import { AlertCircle, CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CompetitionDeadlineCard } from '@/components/admin/schedule/CompetitionDeadlineCard'
import { formatPounds, type CompetitionDeadline } from '@/lib/types/competition-deadline'

interface ClosingThisWeekProps {
  /** Deadlines within the focus week, already sorted soonest-first. */
  deadlines: CompetitionDeadline[]
  todayKey: string
  /**
   * Heading for the focus week: "Closing This Week" when the focus week is the
   * current (London) week, otherwise a dated label like "Closing 21 – 27 Sep"
   * so it never misleads once the admin navigates away.
   */
  heading: string
  /** One-line description matching the heading (current vs. specific week). */
  subtitle: string
  loading: boolean
  error: boolean
  onRetry: () => void
}

/**
 * The commercial headline of the calendar: the fastest answer to
 * "what do we need to push?". Lists every eligible live non-TikTok competition
 * closing in the focus week, soonest first.
 *
 * Fails soft: if the deadline feed errors it shows a compact retry without
 * taking down the rest of the Schedule page.
 */
export function ClosingThisWeek({
  deadlines,
  todayKey,
  heading,
  subtitle,
  loading,
  error,
  onRetry,
}: ClosingThisWeekProps) {
  // Aggregate potential is only meaningful if EVERY listed item exposes a
  // value; otherwise the total would understate and mislead, so we omit it.
  const allHavePotential =
    deadlines.length > 0 && deadlines.every((d) => d.potentialRemainingPence != null)
  const aggregatePotential = allHavePotential
    ? deadlines.reduce((sum, d) => sum + (d.potentialRemainingPence ?? 0), 0)
    : null

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" aria-hidden="true" />
          <h3 className="text-lg font-bold tracking-tight">{heading}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-3">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertCircle className="size-4" aria-hidden="true" />
            Couldn&apos;t load competition deadlines.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading deadlines…
        </p>
      ) : deadlines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No live competitions close in the shown week.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{deadlines.length}</span>{' '}
            {deadlines.length === 1 ? 'competition' : 'competitions'} closing
            {aggregatePotential != null ? (
              <>
                {' · '}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatPounds(aggregatePotential)}
                </span>{' '}
                potential remaining
              </>
            ) : null}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {deadlines.map((d) => (
              <CompetitionDeadlineCard key={d.campaignId} deadline={d} todayKey={todayKey} />
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
