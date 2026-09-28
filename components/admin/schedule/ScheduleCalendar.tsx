'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  EVENT_TYPES,
  compareEvents,
  monthGridDays,
  scheduleErrorCopy,
  toDateKey,
  type ScheduleEvent,
  type ScheduleEventType,
} from '@/lib/types/schedule'
import {
  addDaysKey,
  compareDeadlines,
  londonTodayKey,
  weekDayKeys,
  weekStartKey,
  type CompetitionDeadline,
} from '@/lib/types/competition-deadline'
import { FilterChips, type TypeFilter } from '@/components/admin/schedule/FilterChips'
import { SourceFilterControl, type SourceFilter } from '@/components/admin/schedule/SourceFilter'
import { MonthSummary } from '@/components/admin/schedule/MonthSummary'
import { MonthGrid } from '@/components/admin/schedule/MonthGrid'
import { WeekView } from '@/components/admin/schedule/WeekView'
import { ClosingThisWeek } from '@/components/admin/schedule/ClosingThisWeek'
import { DayDetail } from '@/components/admin/schedule/DayDetail'
import {
  EventFormDialog,
  type FormMode,
  type ScheduleEventPayload,
} from '@/components/admin/schedule/EventFormDialog'

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const json = await r.json().catch(() => ({}))
    if (!r.ok || json?.ok === false) throw new Error(json?.error || 'load_failed')
    return json
  })

type ViewMode = 'week' | 'month'

/**
 * Sales Calendar container.
 *
 * Merges TWO independent layers only at render time:
 *   Layer A - manual Schedule events (admin_schedule_events), fully editable.
 *   Layer B - read-only live competition deadlines, generated from campaign data.
 *
 * The two layers are fetched with two independent, bounded requests (in
 * parallel via SWR) and never share storage. If one feed fails the other still
 * renders.
 */
export function ScheduleCalendar() {
  const { toast } = useToast()

  // Europe/London "today", captured once per mount. Deadlines and week
  // membership are London-based, so the manual-event UTC "today" is not reused.
  const [today] = useState(() => londonTodayKey())

  const [view, setView] = useState<ViewMode>('week')
  const [weekStart, setWeekStart] = useState(() => weekStartKey(today))
  const [monthView, setMonthView] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const [selectedDate, setSelectedDate] = useState(today)

  const [source, setSource] = useState<SourceFilter>('all')
  const [filter, setFilter] = useState<TypeFilter>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [formInitial, setFormInitial] = useState<ScheduleEvent | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ScheduleEvent | null>(null)
  const [deleting, setDeleting] = useState(false)

  const showEvents = source !== 'competition'
  const showDeadlines = source !== 'planned'

  // Fetch range depends on the view. Week = the 7-day week; Month = the full
  // Mon-Sun grid span (<= 42 days) so every week touching the month - including
  // the focus week and its spill days - is covered by one bounded request.
  const range = useMemo(() => {
    if (view === 'week') {
      return { from: weekStart, to: addDaysKey(weekStart, 6) }
    }
    const days = monthGridDays(monthView.year, monthView.month)
    return { from: toDateKey(days[0]), to: toDateKey(days[days.length - 1]) }
  }, [view, weekStart, monthView])

  // --- Layer A: manual events (independent SWR) ---
  const events = useSWR<{ ok: boolean; items: ScheduleEvent[] }>(
    `/api/admin/schedule?from=${range.from}&to=${range.to}`,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  // --- Layer B: competition deadlines (independent SWR) ---
  const deadlines = useSWR<{ ok: boolean; items: CompetitionDeadline[] }>(
    showDeadlines
      ? `/api/admin/schedule/competition-deadlines?from=${range.from}&to=${range.to}`
      : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const allEvents = events.data?.items ?? []
  const allDeadlines = deadlines.data?.items ?? []

  /** Per-type planned counts for the visible range (before type filter). */
  const counts = useMemo(() => {
    const base = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<
      ScheduleEventType,
      number
    >
    for (const e of allEvents) base[e.eventType] += 1
    return base
  }, [allEvents])

  const filteredEvents = useMemo(
    () => (filter === 'all' ? allEvents : allEvents.filter((e) => e.eventType === filter)),
    [allEvents, filter],
  )

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    if (!showEvents) return map
    for (const e of filteredEvents) {
      const list = map.get(e.scheduledDate)
      if (list) list.push(e)
      else map.set(e.scheduledDate, [e])
    }
    for (const list of map.values()) list.sort(compareEvents)
    return map
  }, [filteredEvents, showEvents])

  const deadlinesByDate = useMemo(() => {
    const map = new Map<string, CompetitionDeadline[]>()
    if (!showDeadlines) return map
    for (const d of allDeadlines) {
      const list = map.get(d.endDate)
      if (list) list.push(d)
      else map.set(d.endDate, [d])
    }
    for (const list of map.values()) list.sort(compareDeadlines)
    return map
  }, [allDeadlines, showDeadlines])

  // Closing This Week = deadlines whose London date is in the week containing
  // the selected day, soonest first.
  const closingThisWeek = useMemo(() => {
    if (!showDeadlines) return []
    const weekKeys = new Set(weekDayKeys(weekStartKey(selectedDate)))
    return allDeadlines.filter((d) => weekKeys.has(d.endDate)).slice().sort(compareDeadlines)
  }, [allDeadlines, selectedDate, showDeadlines])

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(monthView.year, monthView.month, 1))),
    [monthView],
  )

  const weekLabel = useMemo(() => formatWeekRange(weekStart), [weekStart])

  // Closing summary always describes the week that CONTAINS the selected day.
  // Only call it "This Week" when that focus week is the current London week;
  // otherwise show a dated label so it never misleads after navigating away.
  const closing = useMemo(() => {
    const focusWeekStart = weekStartKey(selectedDate)
    const isCurrentWeek = focusWeekStart === weekStartKey(today)
    return isCurrentWeek
      ? {
          heading: 'Closing This Week',
          subtitle: 'Live competitions reaching their closing date this week.',
        }
      : {
          heading: `Closing ${formatWeekRange(focusWeekStart)}`,
          subtitle: 'Live competitions reaching their closing date in the selected week.',
        }
  }, [selectedDate, today])

  const selectedEvents = eventsByDate.get(selectedDate) ?? []
  const selectedDeadlines = deadlinesByDate.get(selectedDate) ?? []

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(monthView.year, monthView.month + delta, 1))
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    setMonthView({ year: y, month: m })
    const firstOfTarget = toDateKey(d)
    setSelectedDate(firstOfTarget.slice(0, 7) === today.slice(0, 7) ? today : firstOfTarget)
  }

  function shiftWeek(delta: number) {
    const newStart = addDaysKey(weekStart, delta * 7)
    setWeekStart(newStart)
    const days = weekDayKeys(newStart)
    setSelectedDate(days.includes(today) ? today : newStart)
  }

  function goToTodayOrWeek() {
    if (view === 'week') {
      setWeekStart(weekStartKey(today))
    } else {
      const [y, m] = today.split('-').map(Number)
      setMonthView({ year: y, month: m - 1 })
    }
    setSelectedDate(today)
  }

  function switchView(next: ViewMode) {
    if (next === view) return
    if (next === 'week') {
      setWeekStart(weekStartKey(selectedDate))
    } else {
      const [y, m] = selectedDate.split('-').map(Number)
      setMonthView({ year: y, month: m - 1 })
    }
    setView(next)
  }

  /** Realign the visible range so a given date is on screen after a save. */
  function focusOnDate(dateKey: string) {
    setSelectedDate(dateKey)
    if (view === 'week') {
      setWeekStart(weekStartKey(dateKey))
    } else {
      const [y, m] = dateKey.split('-').map(Number)
      setMonthView({ year: y, month: m - 1 })
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations (Layer A only - identical semantics to before).
  // ---------------------------------------------------------------------------

  function openCreate(date?: string) {
    setFormMode('create')
    setFormInitial(null)
    if (date) setSelectedDate(date)
    setFormOpen(true)
  }

  function openEdit(event: ScheduleEvent) {
    setFormMode('edit')
    setFormInitial(event)
    setFormOpen(true)
  }

  function openDuplicate(event: ScheduleEvent) {
    setFormMode('duplicate')
    setFormInitial(event)
    setFormOpen(true)
  }

  async function handleSubmit(payload: ScheduleEventPayload) {
    setSaving(true)
    const editing = formMode === 'edit' && formInitial
    try {
      const res = await fetch(
        editing ? `/api/admin/schedule/${formInitial.id}` : '/api/admin/schedule',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        toast({
          title: "Couldn't save this event",
          description: scheduleErrorCopy(json?.error),
          variant: 'destructive',
        })
        return
      }

      setFormOpen(false)
      const savedDate: string = json.item?.scheduledDate ?? payload.scheduledDate
      focusOnDate(savedDate)

      await events.mutate()
      toast({
        title:
          formMode === 'edit'
            ? 'Event updated'
            : formMode === 'duplicate'
              ? 'Event duplicated'
              : 'Event added',
      })
    } catch {
      toast({
        title: "Couldn't save this event",
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/schedule/${deleteTarget.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        toast({
          title: "Couldn't delete this event",
          description: scheduleErrorCopy(json?.error),
          variant: 'destructive',
        })
        return
      }
      setDeleteTarget(null)
      await events.mutate()
      toast({ title: 'Event deleted' })
    } catch {
      toast({
        title: "Couldn't delete this event",
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  const firstLoad = events.isLoading && !events.data
  const refreshing = (events.isValidating && !!events.data) || deadlines.isValidating

  return (
    <div className="flex flex-col gap-4">
      {/* Header: navigation + view toggle + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => (view === 'week' ? shiftWeek(-1) : shiftMonth(-1))}
            aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
            className="size-9"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <h3 className="min-w-[11rem] text-center text-base font-semibold tracking-tight sm:text-lg">
            {view === 'week' ? weekLabel : monthLabel}
          </h3>
          <Button
            variant="outline"
            size="icon"
            onClick={() => (view === 'week' ? shiftWeek(1) : shiftMonth(1))}
            aria-label={view === 'week' ? 'Next week' : 'Next month'}
            className="size-9"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {refreshing ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Loading"
            />
          ) : null}

          {/* Week | Month toggle */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => switchView(v)}
                aria-pressed={view === v}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  view === v
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v}
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={goToTodayOrWeek} className="h-9">
            {view === 'week' ? 'This week' : 'Today'}
          </Button>
          <Button size="sm" onClick={() => openCreate()} className="h-9 gap-1.5">
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      {/* Closing This Week - the commercial headline */}
      {showDeadlines ? (
        <ClosingThisWeek
          deadlines={closingThisWeek}
          todayKey={today}
          heading={closing.heading}
          subtitle={closing.subtitle}
          loading={deadlines.isLoading && !deadlines.data}
          error={!!deadlines.error}
          onRetry={() => deadlines.mutate()}
        />
      ) : null}

      {/* Summary */}
      <MonthSummary
        monthLabel={view === 'week' ? weekLabel : monthLabel}
        counts={counts}
        total={allEvents.length}
        endingsTotal={allDeadlines.length}
        filter={filter}
        showPlanned={showEvents}
        showEndings={showDeadlines}
      />

      {/* Source filter (layer selector) + manual type chips */}
      <div className="flex flex-col gap-3">
        <SourceFilterControl value={source} onChange={setSource} />
        {source !== 'competition' ? (
          <FilterChips
            value={filter}
            onChange={setFilter}
            counts={counts}
            total={allEvents.length}
          />
        ) : null}
      </div>

      {/* Calendar body */}
      {view === 'month' ? (
        <>
          <Card className="overflow-hidden p-0">
            {events.error ? (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <p className="text-sm font-medium">Couldn&apos;t load schedule. Try again.</p>
                <Button variant="outline" size="sm" onClick={() => events.mutate()}>
                  Retry
                </Button>
              </div>
            ) : firstLoad ? (
              <MonthGridSkeleton />
            ) : (
              <MonthGrid
                year={monthView.year}
                month={monthView.month}
                eventsByDate={eventsByDate}
                deadlinesByDate={deadlinesByDate}
                showEvents={showEvents}
                showDeadlines={showDeadlines}
                selectedDate={selectedDate}
                todayKey={today}
                onSelectDate={setSelectedDate}
                loading={refreshing}
              />
            )}
          </Card>

          {!events.error && !firstLoad ? (
            <DayDetail
              dateKey={selectedDate}
              events={selectedEvents}
              deadlines={selectedDeadlines}
              todayKey={today}
              canManage
              onAdd={() => openCreate(selectedDate)}
              onEdit={openEdit}
              onDuplicate={openDuplicate}
              onDelete={setDeleteTarget}
            />
          ) : null}
        </>
      ) : (
        <>
          {events.error && !showDeadlines ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border px-4 py-12 text-center">
              <p className="text-sm font-medium">Couldn&apos;t load schedule. Try again.</p>
              <Button variant="outline" size="sm" onClick={() => events.mutate()}>
                Retry
              </Button>
            </div>
          ) : firstLoad ? (
            <WeekViewSkeleton />
          ) : (
            <>
              {events.error && showEvents ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Couldn&apos;t load planned events. Competition deadlines are still shown.
                  </span>
                  <Button variant="outline" size="sm" onClick={() => events.mutate()}>
                    Retry
                  </Button>
                </div>
              ) : null}
              <WeekView
                weekStart={weekStart}
                todayKey={today}
                selectedDate={selectedDate}
                deadlinesByDate={deadlinesByDate}
                eventsByDate={eventsByDate}
                showDeadlines={showDeadlines}
                showEvents={showEvents}
                canManage
                onSelectDate={setSelectedDate}
                onAdd={(date) => openCreate(date)}
                onEdit={openEdit}
                onDuplicate={openDuplicate}
                onDelete={setDeleteTarget}
              />
            </>
          )}
        </>
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initial={formInitial}
        defaultDate={selectedDate}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this schedule item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `"${deleteTarget.title}" ` : ''}will be removed from the planning
              calendar. This affects nothing else in WTF.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function keyToUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "21 – 27 Sep" for the Mon–Sun week beginning at `weekStart` (a Monday key). */
function formatWeekRange(weekStart: string): string {
  const start = keyToUtc(weekStart)
  const end = keyToUtc(addDaysKey(weekStart, 6))
  const fmt = (d: Date, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    }).format(d)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`
}

/** Matches the real grid's geometry so there is no layout jump. */
function MonthGridSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading schedule">
      <div className="grid grid-cols-7 border-b border-border">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-1 pb-2">
            <div className="mx-auto h-3 w-6 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'min-h-[3.25rem] border-b border-r border-border p-1 sm:min-h-[5.5rem] sm:p-1.5',
              '[&:nth-child(7n)]:border-r-0',
            )}
          >
            <div className="size-6 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekViewSkeleton() {
  return (
    <div className="grid gap-3 2xl:grid-cols-2" aria-busy="true" aria-label="Loading week">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <div className="h-4 w-24 rounded bg-muted" />
          </div>
          <div className="p-3">
            <div className="h-12 w-full rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  )
}
