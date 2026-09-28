import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/admin/auth'
import { ScheduleCalendar } from '@/components/admin/schedule/ScheduleCalendar'

export const metadata: Metadata = {
  title: 'Schedule | WTF Admin',
  description: 'Competition and live planning calendar.',
}

/**
 * /admin/schedule - manual forward-planning calendar (spec s6 / s7).
 *
 * Renders inside the existing admin shell. The page itself loads no schedule
 * data: the client container owns month/filter state and fetches only the
 * visible month's range (spec s28 / s33).
 */
export default async function SchedulePage() {
  // Same guard convention as every other admin page. Both roles may plan.
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Schedule</h2>
        <p className="text-sm text-muted-foreground">
          Competition &amp; live planning calendar. Entries here are planned manually and are
          entirely separate from live competitions &mdash; adding one never creates or changes a
          campaign.
        </p>
      </div>

      <ScheduleCalendar />
    </div>
  )
}
